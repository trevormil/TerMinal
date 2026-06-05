import { execFile } from 'node:child_process'
import type { RemoteHost } from './settings'
import type { Ticket, NewTicket } from './backlog'
import type { MrDetail, MrListResult } from './mrs'
import type { Entry, ReadResult, SearchHit } from './files'
import type { DocsTree } from './docs'
import type { GitStatus } from './repo'
import type { CiInfo } from './forge'
import type { CiListResult, CiJobsResult, CiLogResult } from './ci'
import type { WorkspaceSearchKind, WorkspaceSearchResponse } from './workspace-search'
import type { Agent, AgentRun } from './agents'
import type { Schedule } from './schedules'
import type { CronRun, UnifiedRun } from './cron-runs'
import type { ProjectSession } from './sessions'
import type { NotesScope } from './notes'
import type { Engine } from './agents'

export type RemoteSessionRef = {
  hostId: string
  label: string
  sshTarget: string
  cwd?: string
  platform?: RemoteHost['platform']
  daemon?: RemoteHost['daemon']
}
export type RemoteRunStartInput = {
  agentId: string
  agentTitle: string
  engine: Engine
  model?: string
  steps: { label: string; prompt: string }[]
  inPlace?: boolean
  prRef?: { iid: number; sourceBranch: string }
  worktreesDir?: string
  enginePath?: string
  scheduleId?: string
}

export type RemoteProbe = {
  cwd: string
  repoRoot: string
  repoPath: string
  repoHost: string
  forgeKind: 'github' | 'gitlab'
  forgeLabel: 'PR' | 'MR'
  forgeSym: '#' | '!'
  hasBacklog: boolean
  hasDocs: boolean
  hasSessions: boolean
  hasAgents: boolean
  engines: Record<string, string>
  tools: Record<string, string>
}

const shq = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`)

const REMOTE_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const input = JSON.parse(process.argv[1] || '{}');
const cwdInput = process.cwd();
function run(cmd,args,opts={}){try{return cp.execFileSync(cmd,args,{cwd:opts.cwd||cwdInput,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:opts.timeout||12000,maxBuffer:opts.maxBuffer||8*1024*1024}).trim()}catch(e){return ''}}
function runObj(cmd,args,opts={}){try{return {stdout:cp.execFileSync(cmd,args,{cwd:opts.cwd||cwdInput,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:opts.timeout||12000,maxBuffer:opts.maxBuffer||8*1024*1024}),error:''}}catch(e){return {stdout:e.stdout?String(e.stdout):'',error:(e.stderr?String(e.stderr):e.message||'error').trim()}}}
function exists(p){try{return fs.existsSync(p)}catch{return false}}
function stat(p){try{return fs.statSync(p)}catch{return null}}
function repoRoot(){return run('git',['rev-parse','--show-toplevel'])}
function repoRemote(root){return run('git',['-C',root,'remote','get-url','origin'])}
function parseRemote(url){url=String(url||'').trim().replace(/\.git$/,'');let m=url.match(/^https?:\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);if(m)return {host:m[1],path:m[2]};m=url.match(/^(?:ssh:\/\/)?[\w.-]+@([^:/]+)[:/](.+)$/);return m?{host:m[1],path:m[2]}:null}
function forge(root){const repo=parseRemote(repoRemote(root));const kind=repo&&/(^|\.)github\.com$/i.test(repo.host)?'github':'gitlab';return {repo,kind,cli:kind==='github'?'gh':'glab',label:kind==='github'?'PR':'MR',sym:kind==='github'?'#':'!'}}
function safe(root,rel){const r=path.resolve(root);const p=path.resolve(root,rel||'.');return (p===r||p.startsWith(r+path.sep))?p:null}
function parseFm(md){const m=String(md||'').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);const fm={},body=m?m[2]:md||'';(m?m[1]:'').split(/\n/).forEach(line=>{const mm=line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);if(!mm)return;let v=mm[2].trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);if(v==='[]')v=[];fm[mm[1]]=v});return {fm,body:String(body).trim()}}
function arr(v){return Array.isArray(v)?v:[]}
function deps(v){return arr(v).map(x=>parseInt(x,10)).filter(n=>Number.isFinite(n)&&n>0)}
function ticket(slug,md){const p=parseFm(md),f=p.fm;return {slug,id:Number(f.id)||0,title:f.title||slug,status:f.status||'open',priority:f.priority||'medium',horizon:f.horizon||'now',hitl:f.hitl==='true'||f.hitl===true,type:f.type||'feature',source:f.source||'',created:f.created||'',updated:f.updated||'',prs:arr(f.prs),refs:arr(f.refs),depends_on:deps(f.depends_on),body:p.body}}
function listTickets(root){const dir=path.join(root,'backlog');if(!exists(dir))return [];return fs.readdirSync(dir).filter(f=>/^\d/.test(f)&&f.endsWith('.md')).map(f=>{try{return ticket(f.replace(/\.md$/,''),fs.readFileSync(path.join(dir,f),'utf8'))}catch{return null}}).filter(Boolean).sort((a,b)=>b.id-a.id)}
function today(){return new Date().toISOString().slice(0,10)}
function slugify(s){return (String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50)||'ticket')}
function listDir(root,rel){const abs=safe(root,rel);if(!abs||!exists(abs))return [];return fs.readdirSync(abs).filter(n=>!['.git','node_modules','out','dist','.next','.cache','.turbo','.vite','coverage','.DS_Store'].includes(n)).map(n=>{const p=path.join(abs,n);const st=stat(p);return st?{name:n,path:rel?path.join(rel,n):n,dir:st.isDirectory()}:null}).filter(Boolean).sort((a,b)=>a.dir===b.dir?a.name.localeCompare(b.name):a.dir?-1:1)}
function readFile(root,rel){const abs=safe(root,rel);if(!abs||!exists(abs))return {ok:false,content:'',reason:'not found'};const st=stat(abs);if(!st)return {ok:false,content:'',reason:'not found'};if(st.isDirectory())return {ok:false,content:'',reason:'directory'};if(st.size>2000000)return {ok:false,content:'',reason:'file too large (>2 MB)'};const b=fs.readFileSync(abs);if(b.includes(0))return {ok:false,content:'',reason:'binary file'};return {ok:true,content:b.toString('utf8')}}
function writeFile(root,rel,content){const abs=safe(root,rel);if(!abs)return false;fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,String(content||''));return true}
function search(root,q){q=String(q||'').trim();if(q.length<2)return [];let r=runObj('git',['-C',root,'grep','-n','-I','--no-color','--untracked','-F','-i','-m','30','-e',q],{cwd:root,maxBuffer:16*1024*1024});let out=r.stdout;if(!out&&r.error)out=runObj('grep',['-rnI','-F','-i','-m','30','--exclude-dir=.git','--exclude-dir=node_modules',q,root],{cwd:root,maxBuffer:16*1024*1024}).stdout.replaceAll(root+path.sep,'');return String(out||'').split('\n').filter(Boolean).slice(0,300).map(l=>{const m=l.match(/^(.*?):(\d+):(.*)$/);return m?{file:m[1],line:Number(m[2]),text:m[3].slice(0,240)}:null}).filter(Boolean)}
function docs(root){const cats=['changelog','maintainer','developer','personal','reports','other'];const labels={changelog:'Changelog',maintainer:'Maintainer',developer:'Developer',personal:'Personal',reports:'Reports',other:'Other'};const items=[];function add(p){const rel=path.relative(root,p).split(path.sep).join('/');const txt=fs.readFileSync(p,'utf8');const h=txt.match(/^#\s+(.+?)\s*$/m);let c='other';if(rel==='CHANGELOG.md')c='changelog';else if(rel.startsWith('docs/maintainer/'))c='maintainer';else if(rel.startsWith('docs/developer/'))c='developer';else if(rel.startsWith('docs/personal/'))c='personal';else if(rel.startsWith('reports/')||rel.startsWith('checks/'))c='reports';items.push({path:rel,title:h?h[1].trim():path.basename(rel).replace(/\.(md|mdx|markdown)$/i,''),category:c,subgroup:c==='reports'?rel.split('/')[1]:undefined})}function walk(d){if(!exists(d))return;for(const n of fs.readdirSync(d)){if(n.startsWith('.'))continue;const p=path.join(d,n),st=stat(p);if(!st)continue;if(st.isDirectory())walk(p);else if(/\.(md|mdx|markdown)$/i.test(n))add(p)}}walk(path.join(root,'docs'));walk(path.join(root,'reports'));walk(path.join(root,'checks'));const changelog=path.join(root,'CHANGELOG.md');if(exists(changelog))add(changelog);return {categories:cats.map(id=>({id,label:labels[id],items:items.filter(x=>x.category===id).sort((a,b)=>a.path.localeCompare(b.path))}))}}
function normLabels(raw){if(!Array.isArray(raw))return [];return raw.map(x=>typeof x==='string'?x:(x&&x.name)||'').filter(Boolean)}
function normState(s){s=String(s||'').toLowerCase();return s==='open'?'opened':s}
function ghRaw(m){return {iid:Number(m.number),title:m.title||'',state:normState(m.state),author:(m.author&& (m.author.login||m.author.name))||'',webUrl:m.url||'',sourceBranch:m.headRefName||'',draft:!!m.isDraft,headShort:String(m.headRefOid||'').slice(0,7),labels:normLabels(m.labels),review:null}}
function glabRaw(m){const iid=m.iid??m.IID??m.number;return {iid:Number(iid),title:m.title||'',state:normState(m.state),author:(m.author&&(m.author.username||m.author.name))||'',webUrl:m.web_url||m.webUrl||'',sourceBranch:m.source_branch||m.sourceBranch||'',draft:!!(m.draft??m.work_in_progress),headShort:String(m.sha||(m.diff_refs&&m.diff_refs.head_sha)||'').slice(0,7),labels:normLabels(m.labels),review:null}}
function parseJson(s,f){try{return JSON.parse(s||'')}catch{return f}}
function listMrs(root){const f=forge(root);if(f.kind==='github'){const r=runObj('gh',['pr','list','--state','all','--limit','100','--json','number,title,state,author,headRefName,isDraft,url,labels'],{cwd:root});if(r.error&&!r.stdout)return {mrs:[],error:r.error};return {mrs:parseJson(r.stdout,[]).map(ghRaw)}}const r=runObj('glab',['mr','list','--all','-F','json','-P','100'],{cwd:root});if(r.error&&!r.stdout)return {mrs:[],error:r.error};return {mrs:parseJson(r.stdout,[]).map(glabRaw)}}
function mrDetail(root,iid){const f=forge(root);if(f.kind==='github'){const r=runObj('gh',['pr','view',String(iid),'--json','number,title,state,author,headRefName,isDraft,url,labels,baseRefName,body'],{cwd:root});const m=parseJson(r.stdout,null);return m?{...ghRaw(m),description:m.body||'',targetBranch:m.baseRefName||'',reviewMd:'',reviewMeta:null,findings:[],suggestions:[],artifactShortSha:''}:null}const r=runObj('glab',['mr','view',String(iid),'-F','json'],{cwd:root});const m=parseJson(r.stdout,null);return m?{...glabRaw(m),iid:Number(m.iid||m.IID||iid),description:m.description||'',targetBranch:m.target_branch||'',reviewMd:'',reviewMeta:null,findings:[],suggestions:[],artifactShortSha:''}:null}
function ciStatus(s,c){if(s==='completed')return c==='success'?'success':c==='cancelled'?'canceled':c==='skipped'?'skipped':'failed';if(s==='in_progress')return 'in_progress';if(['queued','waiting','requested'].includes(s))return 'queued';return s||'pending'}
function ciList(root,limit){const f=forge(root);if(f.kind!=='github')return {runs:[],error:'remote GitLab CI not implemented yet'};const r=runObj('gh',['run','list','--limit',String(limit||40),'--json','databaseId,status,conclusion,workflowName,headBranch,headSha,event,url,createdAt,updatedAt'],{cwd:root});if(r.error&&!r.stdout)return {runs:[],error:r.error};return {runs:parseJson(r.stdout,[]).map(x=>{const created=Date.parse(x.createdAt||'')||0,updated=Date.parse(x.updatedAt||'')||created,status=ciStatus(x.status||'',x.conclusion);return {id:String(x.databaseId||''),name:x.workflowName||'',status,branch:x.headBranch||'',shortSha:String(x.headSha||'').slice(0,7),event:x.event||'',webUrl:x.url||'',createdAt:created,updatedAt:updated,durationMs:status==='in_progress'||status==='queued'?null:Math.max(0,updated-created)}})}}
function home(){return process.env.HOME||''}
function cfg(){return path.join(home(),'.config','TerMinal')}
function readJson(p,f){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return f}}
function writeJson(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2));return true}
function agentArr(v){return Array.isArray(v)?v:(Array.isArray(v&&v.agents)?v.agents:[])}
function readRepoAgents(root){const out=[];const dir=path.join(root,'.agents');for(const a of agentArr(readJson(path.join(dir,'agents.json'),[]))){if(a&&a.id&&a.title)out.push({...a,source:'repo',hasScript:exists(path.join(dir,a.id+'.sh'))})}if(exists(dir)){for(const f of fs.readdirSync(dir)){if(!f.endsWith('.sh'))continue;const id=f.replace(/\.sh$/,'');if(out.some(a=>a.id===id))continue;out.push({id,title:id.replace(/-/g,' '),prompt:'Script-based remote agent · body in .agents/'+f,source:'repo',hasScript:true})}}return out}
function readAgentScript(root,id){const safe=String(id||'').replace(/[^\w-]/g,'');const p=path.join(root,'.agents',safe+'.sh');if(!exists(p))return null;return {path:p,body:fs.readFileSync(p,'utf8')}}
function schedules(){return readJson(path.join(cfg(),'schedules.json'),[])}
function cronRuns(scheduleId,limit){const dir=path.join(cfg(),'cron-runs');if(!exists(dir))return [];const out=[];for(const f of fs.readdirSync(dir)){if(!f.endsWith('.json'))continue;try{const r=JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));if(!scheduleId||r.scheduleId===scheduleId)out.push(r)}catch{}}return out.sort((a,b)=>(b.startedAt||0)-(a.startedAt||0)).slice(0,limit||200)}
function unifiedRuns(){return cronRuns(null,400).map(r=>({id:r.id,source:r.source||'cron',agentId:r.agentId,agentTitle:r.agentTitle,engine:r.engine,status:r.status,startedAt:r.startedAt,endedAt:r.endedAt,exitCode:r.exitCode,repoRoot:r.repoRoot||'',repoLabel:r.repoLabel||'',branch:r.branch||'',worktree:r.worktree||'',scheduleId:r.scheduleId,error:r.error}))}
function runLog(id){const safe=String(id||'').replace(/[^\w-]/g,'');try{return fs.readFileSync(path.join(cfg(),'cron-runs',safe+'.log'),'utf8')}catch{return ''}}
function projectSession(slug,md,withBody){const p=parseFm(md),f=p.fm;return {slug,id:Number(f.id)||0,title:f.title||slug,status:f.status||'active',goal:f.goal||'',started:f.started||'',ended:f.ended==='null'?'':(f.ended||''),anchor:f.anchor||'',tickets:arr(f.tickets),branches:arr(f.branches),prs:arr(f.prs),...(withBody?{body:p.body}: {})}}
function sessionsList(root){const dir=path.join(root,'sessions');if(!exists(dir))return [];return fs.readdirSync(dir).filter(d=>/^\d+-/.test(d)&&exists(path.join(dir,d,'session.md'))).map(d=>{try{return projectSession(d,fs.readFileSync(path.join(dir,d,'session.md'),'utf8'),false)}catch{return null}}).filter(Boolean).sort((a,b)=>b.id-a.id)}
function sessionGet(root,slug){const safeSlug=String(slug||'').replace(/[^\w-]/g,'');const p=path.join(root,'sessions',safeSlug,'session.md');return exists(p)?projectSession(safeSlug,fs.readFileSync(p,'utf8'),true):null}
function notesPath(root,scope){return scope==='global'?path.join(cfg(),'notes.md'):path.join(root,'.TerMinal','notes.md')}
function notesRead(root,scope){try{return fs.readFileSync(notesPath(root,scope),'utf8')}catch{return ''}}
function notesWrite(root,scope,content){const p=notesPath(root,scope);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,String(content||''));if(scope==='repo'){try{const gi=path.join(root,'.gitignore'),entry='.TerMinal/notes.md';let c=exists(gi)?fs.readFileSync(gi,'utf8'):'';if(!c.split('\n').some(l=>l.trim()===entry)){if(c&&!c.endsWith('\n'))c+='\n';fs.writeFileSync(gi,c+entry+'\n')}}catch{}}return true}
function sq(s){return "'"+String(s||'').replace(/'/g,"'\\''")+"'";}
function shPath(s){s=String(s||'');return s.startsWith('~/')?'"$HOME"/'+sq(s.slice(2)):sq(s)}
function shellBin(engine,override){if(override&&String(override).trim())return String(override).trim();return engine==='cursor'?'cursor-agent':engine}
function runStart(root,input){
  const crypto=require('crypto');
  if(!root)throw new Error('not a git repo');
  const steps=Array.isArray(input.steps)?input.steps:[];
  if(!steps.length)throw new Error('no steps');
  const id=crypto.randomUUID(),startedAt=Date.now(),short=id.slice(0,6);
  const tag=String(input.agentId||'agent').replace(/[^\w-]/g,'').slice(0,40)||'agent';
  const repoLabel=(forge(root).repo&&forge(root).repo.path)||path.basename(root);
  const runsDir=path.join(cfg(),'cron-runs'),promptDir=path.join(cfg(),'remote-run-prompts',id);
  fs.mkdirSync(runsDir,{recursive:true});fs.mkdirSync(promptDir,{recursive:true});
  let worktree=root,branch='(working tree)';
  if(!input.inPlace){
    const parent=input.worktreesDir||path.join(cfg(),'remote-worktrees',path.basename(root)||'repo');
    fs.mkdirSync(parent,{recursive:true});
    worktree=path.join(parent,tag+'-'+short);
    if(input.prRef&&input.prRef.sourceBranch){
      runObj('git',['-C',root,'fetch','origin',String(input.prRef.sourceBranch)],{timeout:60000});
      let ref='origin/'+String(input.prRef.sourceBranch);
      if(!run('git',['-C',root,'rev-parse','--verify','--quiet',ref]))ref='FETCH_HEAD';
      const r=runObj('git',['-C',root,'worktree','add','--detach',worktree,ref],{timeout:60000});
      if(r.error)throw new Error('worktree: '+r.error);
      branch=String(input.prRef.sourceBranch);
    }else{
      branch='agent/'+tag+'-'+short;
      let base='HEAD';
      if(run('git',['-C',root,'rev-parse','--verify','--quiet','main']))base='main';
      else if(run('git',['-C',root,'rev-parse','--verify','--quiet','master']))base='master';
      const r=runObj('git',['-C',root,'worktree','add',worktree,'-b',branch,base],{timeout:60000});
      if(r.error)throw new Error('worktree: '+r.error);
    }
  }
  const logFile=path.join(runsDir,id+'.log'),jsonFile=path.join(runsDir,id+'.json'),scriptPath=path.join(promptDir,'run.sh');
  const promptFiles=steps.map((s,i)=>{const f=path.join(promptDir,String(i)+'.txt');fs.writeFileSync(f,String(s&&s.prompt||''));return f});
  const scriptAgent=path.join(root,'.agents',String(input.agentId||'').replace(/[^\w-]/g,'')+'.sh');
  const engine=String(input.engine||'claude'),bin=shellBin(engine,input.enginePath),model=String(input.model||'');
  const labels=steps.map(s=>String(s&&s.label||'run'));
  const modelFlag=model?' --model '+sq(model):'';
  const stepBlocks=promptFiles.map((pf,i)=>[
    'echo '+sq('━━ step '+(i+1)+'/'+promptFiles.length+' · '+labels[i]+' ━━'),
    'PROMPT="$(cat '+sq(pf)+')"',
    'if [ -x '+sq(scriptAgent)+' ]; then',
    '  '+sq(scriptAgent),
    'elif [ '+sq(engine)+' = "claude" ]; then',
    '  '+shPath(bin)+' -p "$PROMPT" --dangerously-skip-permissions'+modelFlag,
    'elif [ '+sq(engine)+' = "cursor" ]; then',
    '  '+shPath(bin)+' -p --force --trust --output-format text --workspace '+sq(worktree)+modelFlag+' "$PROMPT"',
    'else',
    '  '+shPath(bin)+' exec -s danger-full-access -C '+sq(worktree)+modelFlag+' "$PROMPT"',
    'fi',
    'code=$?',
    'if [ "$code" != "0" ]; then finish "$code"; exit "$code"; fi',
  ].join('\n')).join('\n');
  const runner=[
    '#!/usr/bin/env bash',
    'set +e',
    'export PATH="$HOME/.local/bin:$HOME/bin:$HOME/.bun/bin:$HOME/.npm-global/bin:$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"',
    '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"',
    'export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1 CLICOLOR_FORCE=1',
    'export TERMINAL_REPO='+sq(root),
    'export TERMINAL_RUN_ID='+sq(id),
    'export TERMINAL_AGENT_ID='+sq(input.agentId||'remote-agent'),
    'export TERMINAL_BRANCH='+sq(branch),
    'export TERMINAL_WORKTREE='+sq(worktree),
    'export TERMINAL_ENGINE='+sq(engine),
    model?'export TERMINAL_MODEL='+sq(model):'',
    'finish() {',
    '  code="$1"',
    '  status=done',
    '  [ "$code" = "0" ] || status=failed',
    '  node - "$JSON_FILE" "$status" "$code" <<'+"'NODE'",
    'const fs=require("fs"); const [file,status,code]=process.argv.slice(2);',
    'let r={}; try{r=JSON.parse(fs.readFileSync(file,"utf8"))}catch{}',
    'r.status=status; r.endedAt=Date.now(); r.exitCode=Number(code)||0;',
    'fs.writeFileSync(file, JSON.stringify(r,null,2));',
    'NODE',
    '}',
    "trap 'finish 130; exit 130' INT TERM",
    'JSON_FILE='+sq(jsonFile),
    'echo '+sq('▸ Remote agent · '+String(input.agentTitle||input.agentId||'Agent')+' · '+engine+(model?'/'+model:'')),
    'echo '+sq('▸ branch '+branch),
    'echo '+sq('▸ worktree '+worktree),
    'echo',
    stepBlocks,
    'finish 0',
    '',
  ].filter(Boolean).join('\n');
  fs.writeFileSync(scriptPath,runner,{mode:0o755});
  const record={id,source:input.scheduleId?'cron':'agent',scheduleId:input.scheduleId||'',agentId:input.agentId||'remote-agent',agentTitle:input.agentTitle||input.agentId||'Remote agent',engine,status:'running',startedAt,branch,repoLabel,repoRoot:root,worktree,logFile};
  fs.writeFileSync(jsonFile,JSON.stringify(record,null,2));
  const child=cp.spawn('bash',[scriptPath],{cwd:worktree,detached:true,stdio:['ignore',fs.openSync(logFile,'a'),fs.openSync(logFile,'a')]});
  child.unref();
  record.pid=child.pid;
  fs.writeFileSync(jsonFile,JSON.stringify(record,null,2));
  return {...record,output:'▸ remote run started\\n',force:false}
}
function schedulesSave(input){const list=schedules();const idx=list.findIndex(s=>s.id===input.id);if(idx>=0)list[idx]=input;else list.push(input);writeJson(path.join(cfg(),'schedules.json'),list);return {ok:true,id:input.id}}
function scheduleRemove(id){const next=schedules().filter(s=>s.id!==id);writeJson(path.join(cfg(),'schedules.json'),next);return true}
function scheduleToggle(id,enabled){const list=schedules();const s=list.find(x=>x.id===id);if(!s)return false;s.enabled=!!enabled;writeJson(path.join(cfg(),'schedules.json'),list);return true}
function out(v){process.stdout.write(JSON.stringify(v))}
try{const op=input.op;const root=repoRoot()||cwdInput; if(op==='probe'){const rr=repoRoot();const f=rr?forge(rr):{repo:null,kind:'github',label:'PR',sym:'#'};out({cwd:cwdInput,repoRoot:rr,repoPath:f.repo?f.repo.path:'',repoHost:f.repo?f.repo.host:'',forgeKind:f.kind,forgeLabel:f.label,forgeSym:f.sym,hasBacklog:!!(rr&&exists(path.join(rr,'backlog'))),hasDocs:!!(rr&&(exists(path.join(rr,'docs'))||exists(path.join(rr,'reports'))||exists(path.join(rr,'CHANGELOG.md')))),hasSessions:!!(rr&&exists(path.join(rr,'sessions'))),hasAgents:!!(rr&&exists(path.join(rr,'.agents'))),engines:{claude:run('bash',['-lc','command -v claude || true']),codex:run('bash',['-lc','command -v codex || true']),cursor:run('bash',['-lc','command -v cursor-agent || true'])},tools:{node:run('bash',['-lc','command -v node || true']),git:run('bash',['-lc','command -v git || true']),gh:run('bash',['-lc','command -v gh || true']),glab:run('bash',['-lc','command -v glab || true']),rg:run('bash',['-lc','command -v rg || true'])}})}
else if(op==='gitStatus'){const b=run('git',['-C',root,'rev-parse','--abbrev-ref','HEAD']);const ab=run('git',['-C',root,'rev-list','--left-right','--count','@{upstream}...HEAD']);const p=run('git',['-C',root,'status','--porcelain']);const parts=ab?ab.split(/\s+/).map(Number):[0,0];out({ok:!!b,branch:b,ahead:parts[1]||0,behind:parts[0]||0,dirty:p?p.split('\n').filter(Boolean).length:0})}
else if(op==='tickets.list')out(listTickets(root));else if(op==='tickets.get')out(listTickets(root).find(t=>t.slug===String(input.slug||'').replace(/[^\w-]/g,''))||null);
else if(op==='tickets.update'){const safe=String(input.slug||'').replace(/[^\w-]/g,''),p=path.join(root,'backlog',safe+'.md');if(!exists(p))out(false);else{let md=fs.readFileSync(p,'utf8');const patch=input.patch||{};function set(k,v){const re=new RegExp('^('+k+':[ \t]*).*$', 'm');md=re.test(md)?md.replace(re,'$1'+v):md.replace(/\n---/, '\n'+k+': '+v+'\n---')}if(patch.status)set('status',patch.status);if(patch.priority)set('priority',patch.priority);set('updated',today());fs.writeFileSync(p,md);out(true)}}
else if(op==='tickets.create'){const dir=path.join(root,'backlog');if(!exists(dir))throw new Error('no backlog/ in this repo');const inputT=input.ticket||{};const next=listTickets(root).reduce((m,t)=>Math.max(m,t.id),0)+1;const slug=String(next).padStart(4,'0')+'-'+slugify(inputT.title);const md=['---','id: '+next,'title: "'+String(inputT.title||'Untitled').replace(/"/g,"'")+'"','status: '+(inputT.status||'open'),'priority: '+(inputT.priority||'medium'),'horizon: now','type: '+(inputT.type||'feature'),'source: TerMinal','created: '+today(),'updated: '+today(),'prs: []','refs: []','---','',String(inputT.body||'').trim(),''].join('\n');fs.writeFileSync(path.join(dir,slug+'.md'),md);out(ticket(slug,md))}
else if(op==='mrs.list')out(listMrs(root));else if(op==='mrs.get')out(mrDetail(root,input.iid));else if(op==='mrs.diff'){const f=forge(root);out(runObj(f.cli,f.kind==='github'?['pr','diff',String(input.iid)]:['mr','diff',String(input.iid)],{cwd:root,maxBuffer:16*1024*1024}).stdout||'')}
else if(op==='mrs.ci')out(null);else if(op==='mrs.merge'){const f=forge(root);const r=runObj(f.cli,f.kind==='github'?['pr','merge',String(input.iid),'--merge']:['mr','merge',String(input.iid),'--yes'],{cwd:root,timeout:60000});out(r.error?{ok:false,error:r.error}:{ok:true})}
else if(op==='ci.list')out(ciList(root,input.limit||40));else if(op==='ci.jobs')out({jobs:[],error:'remote job detail not implemented yet'});else if(op==='ci.log')out({log:'',error:'remote CI log not implemented yet'});
else if(op==='files.list')out(listDir(root,input.rel||''));else if(op==='files.read')out(readFile(root,input.rel||''));else if(op==='files.write')out(writeFile(root,input.rel||'',input.content||''));else if(op==='files.search')out(search(root,input.q||''));else if(op==='files.create'){const p=safe(root,input.rel||'');if(!p||exists(p))out(false);else{if(input.dir)fs.mkdirSync(p,{recursive:true});else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'')}out(true)}}else if(op==='files.rename'){const a=safe(root,input.from||''),b=safe(root,input.to||'');if(!a||!b||!exists(a)||exists(b))out(false);else{fs.mkdirSync(path.dirname(b),{recursive:true});fs.renameSync(a,b);out(true)}}else if(op==='files.delete'){const p=safe(root,input.rel||'');if(!p||p===path.resolve(root)||!exists(p))out(false);else{fs.rmSync(p,{recursive:true,force:true});out(true)}}
else if(op==='docs.list')out(docs(root));else if(op==='docs.get')out(readFile(root,input.relPath||'').content||'');
else if(op==='agents.list')out(readRepoAgents(root));else if(op==='agents.script')out(readAgentScript(root,input.id));
else if(op==='schedules.list')out(schedules());else if(op==='schedules.runs')out(cronRuns(input.id,200));else if(op==='schedules.runLog')out(runLog(input.runId));
else if(op==='schedules.save')out(schedulesSave(input.schedule));else if(op==='schedules.remove')out(scheduleRemove(input.id));else if(op==='schedules.toggle')out(scheduleToggle(input.id,input.enabled));else if(op==='schedules.runNow'){const s=schedules().find(x=>x.id===input.id);if(!s)out({error:'schedule not found'});else out(runStart(root,{agentId:s.agentId,agentTitle:s.agentTitle,engine:s.engine,model:s.model,steps:[{label:s.agentTitle||s.agentId,prompt:s.prompt}],inPlace:false,worktreesDir:input.worktreesDir,enginePath:input.enginePath,scheduleId:s.id}))}
else if(op==='runs.all')out(unifiedRuns());else if(op==='runs.log')out(runLog(input.runId));
else if(op==='runs.start')out(runStart(root,input.run||{}));
else if(op==='sessions.list')out(sessionsList(root));else if(op==='sessions.get')out(sessionGet(root,input.slug));
else if(op==='notes.read')out(notesRead(root,input.scope));else if(op==='notes.write')out(notesWrite(root,input.scope,input.content));
else if(op==='workspace.search'){const q=String(input.q||'').toLowerCase(),selected=new Set(input.kinds&&input.kinds.length?input.kinds:['file','ticket','mr','doc']);const results=[];function push(x){if(results.length<260)results.push(x)}if(selected.has('file'))for(const h of search(root,q))push({id:'file:'+h.file+':'+h.line,kind:'file',title:h.file+':'+h.line,subtitle:'File',detail:h.text,path:h.file,line:h.line,payload:{path:h.file,line:h.line}});if(selected.has('ticket'))for(const t of listTickets(root)){const hay=[t.id,t.title,t.status,t.priority,t.type,t.body].join(' ').toLowerCase();if(hay.includes(q))push({id:'ticket:'+t.slug,kind:'ticket',title:'#'+t.id+' '+t.title,subtitle:t.status+' - '+t.priority+' - '+t.type,detail:t.body.slice(0,260),path:'backlog/'+t.slug+'.md',payload:{slug:t.slug}})}if(selected.has('mr')){const l=listMrs(root);for(const m of l.mrs){const hay=[m.iid,m.title,m.state,m.author,m.sourceBranch,(m.labels||[]).join(' ')].join(' ').toLowerCase();if(hay.includes(q))push({id:'mr:'+m.iid,kind:'mr',title:'MR/PR '+m.iid+' '+m.title,subtitle:m.state+' - '+m.author,detail:m.sourceBranch,payload:{iid:m.iid}})}}if(selected.has('doc'))for(const c of docs(root).categories)for(const d of c.items){const body=readFile(root,d.path).content||'';if([d.title,d.path,c.label,body].join(' ').toLowerCase().includes(q))push({id:'doc:'+d.path,kind:'doc',title:d.title,subtitle:c.label+' - '+d.path,detail:body.replace(/\s+/g,' ').slice(0,260),path:d.path,payload:{path:d.path}})}out({results})}
else throw new Error('unknown op '+op)}catch(e){out({_remoteError:e.message||String(e)})}
`

function remoteEnvCommand(inner: string, cwd?: string): string {
  const path =
    'export PATH="$HOME/.local/bin:$HOME/bin:$HOME/.bun/bin:$HOME/.npm-global/bin:$HOME/.cargo/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"; ' +
    '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"; '
  const cd = cwd?.trim() && cwd.trim() !== '~' ? `cd -- ${cwd.trim().startsWith('~/') ? `~/${shq(cwd.trim().slice(2))}` : shq(cwd.trim())}; ` : ''
  return `bash -lc ${shq(path + cd + inner)}`
}

export function remoteCommandForEngine(engine: string, args: string[], cwd?: string, overridePath?: string): string {
  const bin = engine === 'local' ? '"${SHELL:-/bin/bash}"' : overridePath?.trim() || (engine === 'cursor' ? 'cursor-agent' : engine)
  const renderedBin = bin.startsWith('~/') ? `"$HOME"/${shq(bin.slice(2))}` : shq(bin)
  const cmd = engine === 'local' ? `exec ${bin} -l` : `exec ${[renderedBin, ...args.map(shq)].join(' ')}`
  return remoteEnvCommand('export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1; ' + cmd, cwd)
}

function remoteJson<T>(remote: RemoteSessionRef, input: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ cwd: remote.cwd || '~', ...input })
    const inner = `node -e ${shq(REMOTE_SCRIPT)} ${shq(payload)}`
    execFile(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', remote.sshTarget, remoteEnvCommand(inner, remote.cwd)],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || 'ssh failed').trim()))
        try {
          const parsed = JSON.parse(stdout || 'null')
          if (parsed?._remoteError) return reject(new Error(parsed._remoteError))
          resolve(parsed as T)
        } catch {
          reject(new Error(`remote returned non-JSON: ${(stdout || stderr || '').slice(0, 300)}`))
        }
      },
    )
  })
}

export const remoteProbe = (remote: RemoteSessionRef) => remoteJson<RemoteProbe>(remote, { op: 'probe' })
export const remoteGitStatus = (remote: RemoteSessionRef) => remoteJson<GitStatus>(remote, { op: 'gitStatus' })
export const remoteTickets = {
  list: (remote: RemoteSessionRef) => remoteJson<Ticket[]>(remote, { op: 'tickets.list' }),
  get: (remote: RemoteSessionRef, slug: string) => remoteJson<Ticket | null>(remote, { op: 'tickets.get', slug }),
  create: (remote: RemoteSessionRef, ticket: NewTicket) => remoteJson<Ticket>(remote, { op: 'tickets.create', ticket }),
  update: (remote: RemoteSessionRef, slug: string, patch: { status?: string; priority?: string }) => remoteJson<boolean>(remote, { op: 'tickets.update', slug, patch }),
}
export const remoteMrs = {
  list: (remote: RemoteSessionRef) => remoteJson<MrListResult>(remote, { op: 'mrs.list' }),
  get: (remote: RemoteSessionRef, iid: number) => remoteJson<MrDetail | null>(remote, { op: 'mrs.get', iid }),
  diff: (remote: RemoteSessionRef, iid: number) => remoteJson<string>(remote, { op: 'mrs.diff', iid }),
  ci: (remote: RemoteSessionRef, iid: number) => remoteJson<CiInfo | null>(remote, { op: 'mrs.ci', iid }),
  merge: (remote: RemoteSessionRef, iid: number) => remoteJson<{ ok: boolean; error?: string }>(remote, { op: 'mrs.merge', iid }),
}
export const remoteCi = {
  list: (remote: RemoteSessionRef, limit?: number) => remoteJson<CiListResult>(remote, { op: 'ci.list', limit }),
  jobs: (remote: RemoteSessionRef, runId: string) => remoteJson<CiJobsResult>(remote, { op: 'ci.jobs', runId }),
  log: (remote: RemoteSessionRef, jobId: string) => remoteJson<CiLogResult>(remote, { op: 'ci.log', jobId }),
}
export const remoteFiles = {
  list: (remote: RemoteSessionRef, rel: string) => remoteJson<Entry[]>(remote, { op: 'files.list', rel }),
  read: (remote: RemoteSessionRef, rel: string) => remoteJson<ReadResult>(remote, { op: 'files.read', rel }),
  write: (remote: RemoteSessionRef, rel: string, content: string) => remoteJson<boolean>(remote, { op: 'files.write', rel, content }),
  search: (remote: RemoteSessionRef, q: string) => remoteJson<SearchHit[]>(remote, { op: 'files.search', q }),
  create: (remote: RemoteSessionRef, rel: string, dir: boolean) => remoteJson<boolean>(remote, { op: 'files.create', rel, dir }),
  rename: (remote: RemoteSessionRef, from: string, to: string) => remoteJson<boolean>(remote, { op: 'files.rename', from, to }),
  del: (remote: RemoteSessionRef, rel: string) => remoteJson<boolean>(remote, { op: 'files.delete', rel }),
}
export const remoteDocs = {
  list: (remote: RemoteSessionRef) => remoteJson<DocsTree>(remote, { op: 'docs.list' }),
  get: (remote: RemoteSessionRef, relPath: string) => remoteJson<string>(remote, { op: 'docs.get', relPath }),
}
export const remoteAgents = {
  list: (remote: RemoteSessionRef) => remoteJson<Agent[]>(remote, { op: 'agents.list' }),
  script: (remote: RemoteSessionRef, id: string) => remoteJson<{ path: string; body: string } | null>(remote, { op: 'agents.script', id }),
}
export const remoteSchedules = {
  list: (remote: RemoteSessionRef) => remoteJson<Schedule[]>(remote, { op: 'schedules.list' }),
  save: (remote: RemoteSessionRef, schedule: Schedule) => remoteJson<{ ok: true; id: string }>(remote, { op: 'schedules.save', schedule }),
  remove: (remote: RemoteSessionRef, id: string) => remoteJson<boolean>(remote, { op: 'schedules.remove', id }),
  toggle: (remote: RemoteSessionRef, id: string, enabled: boolean) => remoteJson<boolean>(remote, { op: 'schedules.toggle', id, enabled }),
  runNow: (remote: RemoteSessionRef, id: string, opts?: { enginePath?: string; worktreesDir?: string }) =>
    remoteJson<AgentRun | { error: string }>(remote, {
      op: 'schedules.runNow',
      id,
      worktreesDir: opts?.worktreesDir ?? remote.daemon?.worktreesDir,
      enginePath: opts?.enginePath,
    }),
  runs: (remote: RemoteSessionRef, id?: string) => remoteJson<CronRun[]>(remote, { op: 'schedules.runs', id }),
  runLog: (remote: RemoteSessionRef, runId: string) => remoteJson<string>(remote, { op: 'schedules.runLog', runId }),
}
export const remoteRuns = {
  all: (remote: RemoteSessionRef) => remoteJson<UnifiedRun[]>(remote, { op: 'runs.all' }),
  log: (remote: RemoteSessionRef, runId: string) => remoteJson<string>(remote, { op: 'runs.log', runId }),
  start: (remote: RemoteSessionRef, run: RemoteRunStartInput) =>
    remoteJson<AgentRun | { error: string }>(remote, {
      op: 'runs.start',
      run: {
        ...run,
        worktreesDir: run.worktreesDir ?? remote.daemon?.worktreesDir,
        enginePath: run.enginePath ?? remote.daemon?.engines?.[run.engine]?.path,
      },
    }),
}
export const remoteSessions = {
  list: (remote: RemoteSessionRef) => remoteJson<ProjectSession[]>(remote, { op: 'sessions.list' }),
  get: (remote: RemoteSessionRef, slug: string) => remoteJson<ProjectSession | null>(remote, { op: 'sessions.get', slug }),
}
export const remoteNotes = {
  read: (remote: RemoteSessionRef, scope: NotesScope) => remoteJson<string>(remote, { op: 'notes.read', scope }),
  write: (remote: RemoteSessionRef, scope: NotesScope, content: string) => remoteJson<boolean>(remote, { op: 'notes.write', scope, content }),
}
export const remoteWorkspaceSearch = (remote: RemoteSessionRef, q: string, kinds?: WorkspaceSearchKind[]) =>
  remoteJson<WorkspaceSearchResponse>(remote, { op: 'workspace.search', q, kinds })
