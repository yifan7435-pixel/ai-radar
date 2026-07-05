import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

function yesterday() {
  const d = new Date(Date.now() - 86400000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

const AI_KW = ['ai','artificial intelligence','llm','large language model','gpt','claude','gemini','copilot','openai','anthropic','transformer','neural network','deep learning','machine learning','rag','agent','vector database','embedding','diffusion','stable diffusion','fine-tuning','lora','qlora','rlhf','langchain','pytorch','tensorflow','inference','quantization','mistral','llama','codex','cursor','autogpt'];

function relevance(text) {
  if (!text) return 0;
  const lower = text.toLowerCase();
  let m = 0;
  for (const kw of AI_KW) { if (lower.includes(kw)) m++; }
  return Math.min(m * 0.15, 1.0);
}

function dedup(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.url.replace(/\/$/, '').toLowerCase();
    if (!seen.has(key) || item.score > seen.get(key).score) seen.set(key, item);
  }
  return [...seen.values()];
}

async function fetchHN() {
  const qs = ['AI','LLM','Claude','OpenAI','Anthropic','machine learning'];
  const r = [];
  const since = Math.floor(Date.now()/1000 - 172800);
  const resps = await Promise.allSettled(qs.map(q => fetch('https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(q) + '&hitsPerPage=50&tags=story&numericFilters=created_at_i>=' + since, { signal: AbortSignal.timeout(10000) }).then(x => x.json())));
  const seen = new Set();
  for (const res of resps) {
    if (res.status !== 'fulfilled') continue;
    for (const hit of res.value.hits || []) {
      if (seen.has(hit.objectID)) continue;
      seen.add(hit.objectID);
      const pts = hit.points || 0; const cmt = hit.num_comments || 0;
      const ar = relevance(hit.title + ' ' + (hit.story_text || ''));
      r.push({ id: 'hn-' + hit.objectID, title: hit.title || 'Untitled', url: hit.url || 'https://news.ycombinator.com/item?id=' + hit.objectID, points: pts, author: hit.author || 'unknown', source: 'Hacker News', desc: hit.story_text ? hit.story_text.substring(0, 200) : '', comments: cmt, score: ar*0.3 + Math.min(pts/200,1)*0.4 + Math.min(cmt/50,1)*0.3 });
    }
  }
  r.sort((a,b) => b.score - a.score);
  return r.slice(0, 30);
}

async function fetchGH() {
  const ts = ['ai','llm','machine-learning','deep-learning','agent'];
  const r = [];
  const since = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  const resps = await Promise.allSettled(ts.map(t => fetch('https://api.github.com/search/repositories?q=topic:' + t + '+pushed:>=' + since + '&sort=stars&order=desc&per_page=10', { headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'agents-radar' }, signal: AbortSignal.timeout(10000) }).then(x => x.ok ? x.json() : null)));
  const seen = new Set();
  for (const res of resps) {
    if (res.status !== 'fulfilled' || !res.value) continue;
    for (const item of res.value.items || []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const text = [item.name, item.description, item.language, (item.topics||[]).join(' ')].filter(Boolean).join(' ');
      const stars = item.stargazers_count || 0; const forks = item.forks_count || 0;
      const ar = relevance(text);
      r.push({ id: 'gh-' + item.id, title: item.full_name || item.name, url: item.html_url, points: stars, author: item.owner?.login || 'unknown', source: 'GitHub', desc: item.description || null, forks: forks, score: ar*0.3 + Math.min(stars/2000,1)*0.5 + Math.min(forks/500,1)*0.2 });
    }
  }
  r.sort((a,b) => b.score - a.score);
  return dedup(r).slice(0, 30);
}

async function fetchArXiv() {
  const cats = ['cs.AI','cs.CL','cs.LG'];
  const r = [];
  const resps = await Promise.allSettled(cats.map(c => fetch('https://export.arxiv.org/api/query?search_query=cat:' + c + '&sortBy=submittedDate&sortOrder=descending&max_results=10', { signal: AbortSignal.timeout(15000) }).then(x => x.text())));
  for (const res of resps) {
    if (res.status !== 'fulfilled') continue;
    const entries = res.value.split('<entry>').slice(1);
    for (const e of entries) {
      const id = (e.match(/<id>([^<]+)<\/id>/) || [])[1] || '';
      const t = (e.match(/<title>([^<]+)<\/title>/) || [])[1] || 'Untitled';
      const s = (e.match(/<summary>([^<]+)<\/summary>/) || [])[1] || '';
      const pub = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
      const authors = (e.match(/<author>\s*<name>([^<]+)<\/name>/g) || []).map(a => a.replace(/<\/?[^>]+>/g, '').trim());
      const cleanT = t.replace(/\s+/g, ' ').trim();
      const cleanS = s.replace(/\s+/g, ' ').trim().substring(0, 300);
      const ar = relevance(cleanT + ' ' + cleanS);
      r.push({ id: 'arxiv-' + (id.split('/').pop()?.split('v')[0] || Math.random().toString(36).slice(2,8)), title: cleanT, url: id || 'https://arxiv.org', points: 0, author: authors[0] || 'unknown', source: 'ArXiv', desc: cleanS.substring(0, 200), score: ar*0.5 + 0.3 });
    }
  }
  r.sort((a,b) => b.score - a.score);
  return r.slice(0, 20);
}

async function fetchAll() {
  console.log('[agents-radar] 正在抓取数据...');
  const [hn, gh, arxiv] = await Promise.all([fetchHN(), fetchGH(), fetchArXiv()]);
  console.log('  HN: ' + hn.length + ' 条, GitHub: ' + gh.length + ' 条, ArXiv: ' + arxiv.length + ' 条');
  const all = dedup([...hn, ...gh, ...arxiv]);
  all.sort((a,b) => b.score - a.score);
  return { all, stats: { hn: hn.length, github: gh.length, arxiv: arxiv.length, total: all.length } };
}

const CAT_NAMES = ['模型与训练','开发工具','代理与自动化','应用与产品','研究与论文','安全与伦理'];
const CAT_KW = [['model','training','llama','gpt','diffusion','llm','foundation'],['framework','sdk','cli','tool','library','api','pipeline'],['agent','autonomous','automation','copilot','codex','assistant','skill'],['app','product','platform','service','startup','demo','deploy'],['paper','research','arxiv','benchmark','evaluation','experiment','study'],['safety','alignment','bias','privacy','security','ethics']];

function classify(item) {
  const t = (item.title + ' ' + (item.desc || '')).toLowerCase();
  for (let i = 0; i < 6; i++) { for (const kw of CAT_KW[i]) { if (t.includes(kw)) return CAT_NAMES[i]; } }
  return '其他';
}

function pickTop(c, n) {
  const r = []; const uS = new Set(), uC = new Set(); const p = [...c];
  while (r.length < n && p.length > 0) {
    let bi = -1, bs = -1;
    for (let i = 0; i < p.length; i++) {
      const x = p[i]; const ct = classify(x); let bn = 0;
      if (!uS.has(x.source)) bn += 0.3;
      if (!uC.has(ct)) bn += 0.4;
      const ad = x.score + bn;
      if (ad > bs) { bs = ad; bi = i; }
    }
    if (bi === -1) break;
    const pk = p.splice(bi, 1)[0]; r.push(pk); uS.add(pk.source); uC.add(classify(pk));
  }
  return r;
}

const PG = [
  '<!DOCTYPE html><html lang=zh-CN><head><meta charset=UTF-8><meta name=viewport content=width=device-width,initial-scale=1.0>',
  '<title>信息雷达 - AI 生态日报</title>',
  '<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#0a0a0f;color:#e4e4e7}.w{max-width:960px;margin:0 auto;padding:20px}.hd{padding:32px 0 24px;border-bottom:1px solid #27272a}.hd h1{font-size:28px;font-weight:700;background:linear-gradient(135deg,#a78bfa,#f472b6);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.s{color:#a1a1aa;font-size:14px}.tb{background:#27272a;border:1px solid #3f3f46;color:#e4e4e7;padding:2px 10px;border-radius:6px;cursor:pointer;font-size:12px}.tb:hover{border-color:#a78bfa}.gt{display:flex;gap:12px;margin-top:12px;flex-wrap:wrap}.gt span{background:#18181b;padding:4px 12px;border-radius:6px;font-size:13px;color:#a1a1aa}.c{background:#18181b;border-radius:12px;padding:20px;margin-bottom:16px;display:flex;gap:16px;border:1px solid #27272a}.c:hover{border-color:#a78bfa}.rk{font-size:24px;font-weight:800;color:#a78bfa;min-width:48px;text-align:center}.t{font-size:16px;font-weight:600;margin-bottom:8px}.t a{color:#e4e4e7;text-decoration:none}.t a:hover{color:#a78bfa}.m{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;font-size:13px;align-items:center}.sh{background:#ff6600;color:#fff}.sg{background:#333;color:#fff;border:1px solid #555}.sa{background:#b31b1b;color:#fff}.sc{color:#fbbf24;font-weight:600}.st{background:#27272a;color:#a1a1aa;font-size:11px}.d{font-size:13px;color:#a1a1aa;line-height:1.5}h2{font-size:18px;font-weight:700;margin:32px 0 16px;color:#e4e4e7}table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:10px 8px;border-bottom:2px solid #27272a;color:#a1a1aa}td{padding:8px;border-bottom:1px solid #27272a}td a{color:#a78bfa;text-decoration:none}.ft{margin-top:48px;padding:24px 0;border-top:1px solid #27272a;text-align:center;color:#52525b;font-size:13px}</style></head><body><div class=w><div class=hd><h1>★ 信息雷达</h1><div class=s>AI 生态日报 | __D__ <span class=tb onclick=toggleLang() id=langBtn>EN</span></div><div class=gt><span>HN: __H__</span><span>GitHub: __G__</span><span>ArXiv: __A__</span><span>共 __T__ 条</span></div></div>',
  '<h2 class=l>⭐ 今日 Top 5</h2><h2 class=r style=display:none>⭐ Top 5</h2>',
  '__C__',
  '<h2 class=l>✅ 全部排名</h2><h2 class=r style=display:none>✅ Ranking</h2>',
  '<table><thead><tr><th>#</th><th class=l>标题</th><th class=r>Title</th><th class=l>来源</th><th class=r>Source</th><th class=l>得分</th><th class=r>Score</th></tr></thead><tbody>__R__</tbody></table>',
  '<div class=ft>由 agents-radar 自动生成 | 数据来自 HN / GitHub / ArXiv 公开 API</div></div>',
  '<script>var l="l";function toggleLang(){l=l==="l"?"r":"l";document.querySelectorAll(".l").forEach(function(e){e.style.display=l==="l"?"":"none"});document.querySelectorAll(".r").forEach(function(e){e.style.display=l==="r"?"":"none"});document.getElementById("langBtn").textContent=l==="l"?"EN":"ZH"}toggleLang()</script></body></html>'
].join('');

const NL = String.fromCharCode(10);

function genMarkdown(rs, all, st) {
  const d = yesterday(); const L = [];
  L.push('# 信息雷达 AI 推荐日报'); L.push('');
  L.push('> 报告日期: ' + d + ' | 数据来源: HN / GitHub / ArXiv | 共 ' + st.total + ' 条链接'); L.push('');
  L.push('## ⭐ 今日 Top 5'); L.push('');
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    L.push('### ' + (i+1) + '. [' + r.title + '](' + r.url + ')'); L.push('');
    L.push('- 来源: ' + r.source + ' | 得分: ' + r.score.toFixed(2) + ' | 作者: ' + r.author);
    if (r.source === 'Hacker News') L.push('- ' + r.points + ' 点赞 | ' + r.comments + ' 评论');
    else if (r.source === 'GitHub') L.push('- ⭐ ' + r.points + ' 星标');
    if (r.desc) L.push('- ' + r.desc.substring(0, 150));
    L.push(''); L.push('---'); L.push('');
  }
  L.push('## 数据全览 (' + all.length + ' 条)'); L.push('');
  for (let i = 0; i < Math.min(all.length, 30); i++) {
    const r = all[i];
    L.push((i+1) + '. [' + r.title + '](' + r.url + ') | ' + r.source + ' | ' + r.score.toFixed(2));
  }
  L.push(''); L.push('---'); L.push('');
  L.push('*本报告由 agents-radar 自动生成*');
  return L.join(NL);
}


// ===== Chinese summary generator =====
const ZH_DICT = {
  'hermes-agent': '智能代理框架，支持多步骤推理与工具调用',
  'AutoGPT': '自动化 AI 代理，可自主拆解任务并执行',
  'OpenHands': '开源 AI 编程助手，类似 Devin 的替代方案',
  'deer-flow': '长周期智能代理框架，处理复杂任务编排',
  'dify': 'AI 应用开发平台，可视化编排 LLM 工作流',
  'firecrawl': 'AI 驱动的网页抓取与结构化数据提取工具',
  'langgenius': '开源 LLM 应用开发平台',
  'keras': '深度学习框架，高层神经网络 API',
  'superpowers': 'AI 开发工具集',
  'JavaGuide': 'Java 学习指南与面试准备',
  'tensorflow': 'Google 开源机器学习框架',
  'OpenBB': '开源金融投资分析平台',
  'openclaw': 'AI 代理命令行工具',
  'n8n': '开源工作流自动化工具',
  'pytorch': 'Meta 开源深度学习框架',
  'ML-For-Beginners': '微软机器学习入门教程',
  'netdata': '开源实时监控工具',
  'tesseract': '开源 OCR 文字识别引擎',
  'scikit-learn': 'Python 机器学习库',
  'NousResearch': 'AI 研究组织，专注开源模型开发',
  'Significant-Gravitas': 'AutoGPT 开发团队',
  'bytedance': '字节跳动开源项目',
  'GPT-5.5': 'OpenAI 最新模型版本讨论',
  'Codex': 'AI 编程助手相关讨论',
  'reasoning-token': 'AI 推理过程中的 Token 优化问题',
};

function zhSummary(item) {
  const t = (item.title + ' ' + (item.desc || '')).toLowerCase();
  for (const [key, summary] of Object.entries(ZH_DICT)) {
    if (t.includes(key.toLowerCase())) return summary;
  }
  // Keyword-based fallback
  if (t.includes('agent') || t.includes('agents')) return 'AI 代理与自动化相关项目';
  if (t.includes('model') || t.includes('llm')) return 'AI 模型与语言模型相关';
  if (t.includes('training') || t.includes('learning')) return '机器学习训练相关内容';
  if (t.includes('framework') || t.includes('sdk') || t.includes('api')) return 'AI 开发框架与工具';
  if (t.includes('benchmark') || t.includes('evaluation')) return 'AI 基准测试与评估';
  if (t.includes('safety') || t.includes('alignment')) return 'AI 安全与对齐研究';
  if (t.includes('paper') || t.includes('research')) return 'AI 学术研究论文';
  if (item.source === 'ArXiv') return 'AI 学术论文';
  if (item.desc) return item.desc.substring(0, 40) + '...';
  return 'AI 相关热门内容';
}
function genHTML(rs, all, st) {
  const d = yesterday();
  const cards = rs.map((r,i) => {
    let ex = '';
    if (r.source === 'Hacker News') ex = '<span class=st>' + r.points + ' pts</span><span class=st>' + r.comments + ' cm</span>';
    else if (r.source === 'GitHub') ex = '<span class=st>' + r.points + ' ★</span>';
    const sc = r.source === 'Hacker News' ? 'sh' : (r.source === 'GitHub' ? 'sg' : 'sa');
    const ds = r.desc ? '<div class=d>' + r.desc.substring(0,200) + '</div>' : '';
    const sum = zhSummary(r); return '<div class=c><div class=rk>#'+(i+1)+'</div><div class=t><a href='+r.url+' target=_blank>'+r.title+'</a></div><div class=m><span class="'+sc+'">'+r.source+'</span><span class=sc>'+r.score.toFixed(2)+'</span>'+ex+'</div><div class=d>\ud83d\udcdd ' + sum + '</div>'+ds+'</div>';
  }).join('');
  const rows = all.slice(0,30).map((r,i) => '<tr><td>'+(i+1)+'</td><td><a href='+r.url+' target=_blank>'+r.title+'</a></td><td>'+r.source+'</td><td>'+r.score.toFixed(2)+'</td></tr>').join('');
  return PG.replace('__D__',d).replace('__H__',st.hn).replace('__G__',st.github).replace('__A__',st.arxiv).replace('__T__',st.total).replace('__N__',rs.length).replace('__C__',cards).replace('__R__',rows);
}

async function run() {
  console.log('=== 信息雷达 ===');
  const { all, stats: st } = await fetchAll();
  if (!all || !all.length) { console.log('没有数据'); return; }
  const rs = pickTop(all, 5);
  console.log('⭐ 推荐 Top 5:');
  rs.forEach((r,i) => console.log('  '+(i+1)+'. ['+r.source+'] '+r.title));
  const d = yesterday();
  const dir = join('digests', d);
  mkdirSync(dir, { recursive: true });
  mkdirSync('docs', { recursive: true });
  writeFileSync(join(dir, '信息雷达-日报.md'), genMarkdown(rs, all, st), 'utf-8');
  const h = genHTML(rs, all, st);
  writeFileSync(join('docs', 'index.html'), h, 'utf-8');
  console.log('✓ 生成完成');
  console.log('  报告: ' + resolve(join(dir, '信息雷达-日报.md')));
  console.log('  HTML: ' + resolve(join('docs', 'index.html')));
}

run().catch(console.error);