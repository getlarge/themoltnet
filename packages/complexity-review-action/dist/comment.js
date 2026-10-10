import{i as p,t as l}from"./assets/result-CBrxW-WM.js";import{n as m}from"./assets/config-BRivjJBN.js";import{readFileSync as c}from"node:fs";import{parseArgs as h}from"node:util";var s="<!-- moltnet:complexity-review -->",v=/^[0-9a-f]{40}$/;function o(e,t){if(!v.test(e))throw new Error(`${t} must be a full 40-character lowercase git OID`);return e}function u(e){return[`Head: \`${e.revision}\``,`[workflow run](${e.runUrl})`,...e.taskId?[`Task: \`${e.taskId}\``]:[]].join(" · ")}function w(e){return o(e.revision,"review revision"),`${s}
## MoltNet complexity review

Review in progress for ${u(e)}.

Any result for an earlier head is stale until this revision finishes.`}function f(e){return o(e.reviewedRevision,"reviewed revision"),o(e.currentRevision,"current revision"),`${s}
## MoltNet complexity review

The result for ${u({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId})} is stale.

The pull request now points at \`${e.currentRevision}\`. The superseded result was not published as current guidance.`}function y(e){return o(e.revision,"review revision"),`${s}
## MoltNet complexity review

The review failed for ${u(e)}. No complexity judgment was published.`}function $(e){o(e.revision,"review revision");const t=e.output.composite===void 0?"undetermined":e.output.composite>=.8?"low":e.output.composite>=.5?"moderate":"high",r=e.output.scores.map(n=>`- **${n.criterionId}: ${n.status}** — `+n.rationale).join(`
`),i=e.output.scores.filter(n=>n.status!=="unclear").length;return`${s}
## MoltNet complexity review

Complexity: ${t} burden · head ${e.revision.slice(0,7)} · reviewed in ${Math.round(e.durationMs/1e3)}s

Stages: change map → ${e.domainCount} focused review${e.domainCount===1?"":"s"} → synthesis.

**Weighted composite (assessed criteria only):** ${e.output.composite===void 0?"N/A":e.output.composite.toFixed(2)}

Assessed criteria: ${i}/${e.output.scores.length}.

**Verdict:** ${e.output.verdict}

${r}

`+(e.summarizedPaths?.length?`Generated lockfile contents summarized (change metadata only): ${e.summarizedPaths.map(n=>JSON.stringify(n)).join(", ")}.

`:"")+(e.generatedPaths?.length?`${b(e.generatedPaths)}

`:"")+`_This advisory measures review burden, not correctness or code quality. Low scores are expected for deliberately broad or security-sensitive changes._

`+u(e)}var d=5;function b(e){const t=e.slice(0,d).map(i=>JSON.stringify(i)).join(", "),r=e.length-d;return`Not reviewed, marked \`linguist-generated\` at the base revision (${e.length} file${e.length===1?"":"s"}): ${t}${r>0?` and ${r} more`:""}.`}function k(e,t){return e.find(r=>r.user?.login===t&&r.body?.includes("<!-- moltnet:complexity-review -->"))}var R=class{repo;token;author;fetchImpl;constructor(e,t,r,i=fetch){this.repo=e,this.token=t,this.author=r,this.fetchImpl=i}async request(e,t){const r=await this.fetchImpl(`https://api.github.com${e}`,{...t,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${this.token}`,"content-type":"application/json","x-github-api-version":"2022-11-28",...t?.headers}});if(!r.ok)throw new Error(`GitHub API ${t?.method??"GET"} ${e} failed with ${r.status}`);return await r.json()}getPullRequest(e){return this.request(`/repos/${this.repo}/pulls/${e}`)}async listComments(e){const t=[];for(let r=1;;r+=1){const i=await this.request(`/repos/${this.repo}/issues/${e}/comments?per_page=100&page=${r}`);if(t.push(...i),i.length<100)return t}}async upsertComment(e,t){const r=k(await this.listComments(e),this.author);if(r){await this.request(`/repos/${this.repo}/issues/comments/${r.id}`,{method:"PATCH",body:JSON.stringify({body:t})});return}await this.request(`/repos/${this.repo}/issues/${e}/comments`,{method:"POST",body:JSON.stringify({body:t})})}};async function C(e){o(e.reviewedRevision,"reviewed revision");const t=new R(e.repo,e.token,e.author,e.fetchImpl),r=o((await t.getPullRequest(e.prNumber)).head.sha,"current revision");if(r!==e.reviewedRevision)return await t.upsertComment(e.prNumber,f({reviewedRevision:e.reviewedRevision,currentRevision:r,runUrl:e.runUrl,taskId:e.taskId})),"stale";if(e.mode==="start")return await t.upsertComment(e.prNumber,w({revision:e.reviewedRevision,runUrl:e.runUrl})),"progress";if(!e.reviewSucceeded||!e.taskId||!e.resultPath)return await t.upsertComment(e.prNumber,y({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId})),"failed";const i=JSON.parse(c(e.resultPath,"utf8")),n=i.output;if(!p(l,n))throw new Error("accepted task output is not a valid ComplexityReviewOutput");if(typeof i.durationMs!="number"||!Number.isFinite(i.durationMs)||i.durationMs<0||!Array.isArray(i.taskIds)||i.taskIds.length<3)throw new Error("accepted review report has no valid workflow timing");if(i.summarizedPaths!==void 0&&(!Array.isArray(i.summarizedPaths)||i.summarizedPaths.some(a=>typeof a!="string")))throw new Error("invalid summarized evidence paths");if(i.generatedPaths!==void 0&&(!Array.isArray(i.generatedPaths)||i.generatedPaths.some(a=>typeof a!="string")))throw new Error("invalid generated evidence paths");return await t.upsertComment(e.prNumber,$({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId,durationMs:i.durationMs,domainCount:i.taskIds.length-2,summarizedPaths:i.summarizedPaths,generatedPaths:i.generatedPaths,output:n})),"published"}async function I(){const{values:e}=h({options:{mode:{type:"string"},repo:{type:"string"},pr:{type:"string"},revision:{type:"string"},"run-url":{type:"string"},"task-id":{type:"string"},"review-succeeded":{type:"boolean",default:!1},"result-path":{type:"string"},author:{type:"string"}}});if(e.mode!=="start"&&e.mode!=="publish"||!e.repo||!e.pr||!e.revision||!e["run-url"]||!e.author)throw new Error("Usage: complexity-review-comment --mode start|publish --repo owner/repo --pr N --revision SHA --run-url URL");const t=Number(e.pr);if(!Number.isInteger(t)||t<1)throw new Error("--pr must be a positive integer");const r=m(),i=await C({mode:e.mode,repo:e.repo,prNumber:t,reviewedRevision:e.revision,runUrl:e["run-url"],token:r,author:e.author,taskId:e["task-id"],reviewSucceeded:e["review-succeeded"],resultPath:e["result-path"]});process.stdout.write(`${JSON.stringify({status:i})}
`)}I().catch(e=>{console.error(e),process.exitCode=1});
