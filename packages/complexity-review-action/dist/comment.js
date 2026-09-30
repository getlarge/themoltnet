import{a,o as d}from"./assets/src-CzHxgYqd.js";import{n as c}from"./assets/config-BRivjJBN.js";import{readFileSync as l}from"node:fs";import{parseArgs as m}from"node:util";import{pathToFileURL as h}from"node:url";var n="<!-- moltnet:complexity-review -->",v=/^[0-9a-f]{40}$/;function o(e,t){if(!v.test(e))throw new Error(`${t} must be a full 40-character lowercase git OID`);return e}function s(e){return[`Head: \`${e.revision}\``,`[workflow run](${e.runUrl})`,...e.taskId?[`Task: \`${e.taskId}\``]:[]].join(" · ")}function w(e){return o(e.revision,"review revision"),`${n}
## MoltNet complexity review

Review in progress for ${s(e)}.

Any result for an earlier head is stale until this revision finishes.`}function f(e){return o(e.reviewedRevision,"reviewed revision"),o(e.currentRevision,"current revision"),`${n}
## MoltNet complexity review

The result for ${s({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId})} is stale.

The pull request now points at \`${e.currentRevision}\`. The superseded result was not published as current guidance.`}function y(e){return o(e.revision,"review revision"),`${n}
## MoltNet complexity review

The review failed for ${s(e)}. No complexity judgment was published.`}function $(e){o(e.revision,"review revision");const t=e.output.composite>=.8?"low":e.output.composite>=.5?"moderate":"high",i=e.output.scores.map(r=>`- **${r.criterionId}: ${r.score===1?"pass":"fail"}** — `+r.rationale).join(`
`);return`${n}
## MoltNet complexity review

Complexity: ${t} burden · head ${e.revision.slice(0,7)} · reviewed in ${Math.round(e.durationMs/1e3)}s

Stages: change map → ${e.domainCount} focused review${e.domainCount===1?"":"s"} → synthesis.

**Weighted composite:** ${e.output.composite.toFixed(2)}

**Verdict:** ${e.output.verdict}

${i}

_This advisory measures review burden, not correctness or code quality. Low scores are expected for deliberately broad or security-sensitive changes._

`+s(e)}function b(e,t){return e.find(i=>i.user?.login===t&&i.body?.includes("<!-- moltnet:complexity-review -->"))}var R=class{repo;token;author;fetchImpl;constructor(e,t,i,r=fetch){this.repo=e,this.token=t,this.author=i,this.fetchImpl=r}async request(e,t){const i=await this.fetchImpl(`https://api.github.com${e}`,{...t,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${this.token}`,"content-type":"application/json","x-github-api-version":"2022-11-28",...t?.headers}});if(!i.ok)throw new Error(`GitHub API ${t?.method??"GET"} ${e} failed with ${i.status}`);return await i.json()}getPullRequest(e){return this.request(`/repos/${this.repo}/pulls/${e}`)}async listComments(e){const t=[];for(let i=1;;i+=1){const r=await this.request(`/repos/${this.repo}/issues/${e}/comments?per_page=100&page=${i}`);if(t.push(...r),r.length<100)return t}}async upsertComment(e,t){const i=b(await this.listComments(e),this.author);if(i){await this.request(`/repos/${this.repo}/issues/comments/${i.id}`,{method:"PATCH",body:JSON.stringify({body:t})});return}await this.request(`/repos/${this.repo}/issues/${e}/comments`,{method:"POST",body:JSON.stringify({body:t})})}};async function k(e){o(e.reviewedRevision,"reviewed revision");const t=new R(e.repo,e.token,e.author,e.fetchImpl),i=o((await t.getPullRequest(e.prNumber)).head.sha,"current revision");if(i!==e.reviewedRevision)return await t.upsertComment(e.prNumber,f({reviewedRevision:e.reviewedRevision,currentRevision:i,runUrl:e.runUrl,taskId:e.taskId})),"stale";if(e.mode==="start")return await t.upsertComment(e.prNumber,w({revision:e.reviewedRevision,runUrl:e.runUrl})),"progress";if(!e.reviewSucceeded||!e.taskId||!e.resultPath)return await t.upsertComment(e.prNumber,y({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId})),"failed";const r=JSON.parse(l(e.resultPath,"utf8")),u=r.output;if(!a(d,u))throw new Error("accepted task output is not a valid PrReviewOutput");if(typeof r.durationMs!="number"||!Number.isFinite(r.durationMs)||r.durationMs<0||!Array.isArray(r.taskIds)||r.taskIds.length<3)throw new Error("accepted review report has no valid workflow timing");return await t.upsertComment(e.prNumber,$({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId,durationMs:r.durationMs,domainCount:r.taskIds.length-2,output:u})),"published"}async function p(){const{values:e}=m({options:{mode:{type:"string"},repo:{type:"string"},pr:{type:"string"},revision:{type:"string"},"run-url":{type:"string"},"task-id":{type:"string"},"review-succeeded":{type:"boolean",default:!1},"result-path":{type:"string"},author:{type:"string"}}});if(e.mode!=="start"&&e.mode!=="publish"||!e.repo||!e.pr||!e.revision||!e["run-url"]||!e.author)throw new Error("Usage: complexity-review-comment --mode start|publish --repo owner/repo --pr N --revision SHA --run-url URL");const t=Number(e.pr);if(!Number.isInteger(t)||t<1)throw new Error("--pr must be a positive integer");const i=c(),r=await k({mode:e.mode,repo:e.repo,prNumber:t,reviewedRevision:e.revision,runUrl:e["run-url"],token:i,author:e.author,taskId:e["task-id"],reviewSucceeded:e["review-succeeded"],resultPath:e["result-path"]});process.stdout.write(`${JSON.stringify({status:r})}
`)}process.argv[1]&&import.meta.url===h(process.argv[1]).href&&p().catch(e=>{console.error("[fatal]",e instanceof Error?e.message:e),process.exitCode=1});p().catch(e=>{console.error(e),process.exitCode=1});
