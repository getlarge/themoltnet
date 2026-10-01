import{a as d,o as m}from"./assets/src-CzHxgYqd.js";import{n as l}from"./assets/config-BRivjJBN.js";import{readFileSync as c}from"node:fs";import{parseArgs as h}from"node:util";import{pathToFileURL as v}from"node:url";var n="<!-- moltnet:complexity-review -->",w=/^[0-9a-f]{40}$/;function o(e,t){if(!w.test(e))throw new Error(`${t} must be a full 40-character lowercase git OID`);return e}function s(e){return[`Head: \`${e.revision}\``,`[workflow run](${e.runUrl})`,...e.taskId?[`Task: \`${e.taskId}\``]:[]].join(" · ")}function f(e){return o(e.revision,"review revision"),`${n}
## MoltNet complexity review

Review in progress for ${s(e)}.

Any result for an earlier head is stale until this revision finishes.`}function y(e){return o(e.reviewedRevision,"reviewed revision"),o(e.currentRevision,"current revision"),`${n}
## MoltNet complexity review

The result for ${s({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId})} is stale.

The pull request now points at \`${e.currentRevision}\`. The superseded result was not published as current guidance.`}function $(e){return o(e.revision,"review revision"),`${n}
## MoltNet complexity review

The review failed for ${s(e)}. No complexity judgment was published.`}function b(e){o(e.revision,"review revision");const t=e.output.composite>=.8?"low":e.output.composite>=.5?"moderate":"high",r=e.output.scores.map(i=>`- **${i.criterionId}: ${i.score===1?"pass":"fail"}** — `+i.rationale).join(`
`);return`${n}
## MoltNet complexity review

Complexity: ${t} burden · head ${e.revision.slice(0,7)} · reviewed in ${Math.round(e.durationMs/1e3)}s

Stages: change map → ${e.domainCount} focused review${e.domainCount===1?"":"s"} → synthesis.

**Weighted composite:** ${e.output.composite.toFixed(2)}

**Verdict:** ${e.output.verdict}

${r}

`+(e.summarizedPaths?.length?`Generated lockfile contents summarized (change metadata only): ${e.summarizedPaths.map(i=>JSON.stringify(i)).join(", ")}.

`:"")+`_This advisory measures review burden, not correctness or code quality. Low scores are expected for deliberately broad or security-sensitive changes._

`+s(e)}function k(e,t){return e.find(r=>r.user?.login===t&&r.body?.includes("<!-- moltnet:complexity-review -->"))}var R=class{repo;token;author;fetchImpl;constructor(e,t,r,i=fetch){this.repo=e,this.token=t,this.author=r,this.fetchImpl=i}async request(e,t){const r=await this.fetchImpl(`https://api.github.com${e}`,{...t,headers:{accept:"application/vnd.github+json",authorization:`Bearer ${this.token}`,"content-type":"application/json","x-github-api-version":"2022-11-28",...t?.headers}});if(!r.ok)throw new Error(`GitHub API ${t?.method??"GET"} ${e} failed with ${r.status}`);return await r.json()}getPullRequest(e){return this.request(`/repos/${this.repo}/pulls/${e}`)}async listComments(e){const t=[];for(let r=1;;r+=1){const i=await this.request(`/repos/${this.repo}/issues/${e}/comments?per_page=100&page=${r}`);if(t.push(...i),i.length<100)return t}}async upsertComment(e,t){const r=k(await this.listComments(e),this.author);if(r){await this.request(`/repos/${this.repo}/issues/comments/${r.id}`,{method:"PATCH",body:JSON.stringify({body:t})});return}await this.request(`/repos/${this.repo}/issues/${e}/comments`,{method:"POST",body:JSON.stringify({body:t})})}};async function I(e){o(e.reviewedRevision,"reviewed revision");const t=new R(e.repo,e.token,e.author,e.fetchImpl),r=o((await t.getPullRequest(e.prNumber)).head.sha,"current revision");if(r!==e.reviewedRevision)return await t.upsertComment(e.prNumber,y({reviewedRevision:e.reviewedRevision,currentRevision:r,runUrl:e.runUrl,taskId:e.taskId})),"stale";if(e.mode==="start")return await t.upsertComment(e.prNumber,f({revision:e.reviewedRevision,runUrl:e.runUrl})),"progress";if(!e.reviewSucceeded||!e.taskId||!e.resultPath)return await t.upsertComment(e.prNumber,$({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId})),"failed";const i=JSON.parse(c(e.resultPath,"utf8")),u=i.output;if(!d(m,u))throw new Error("accepted task output is not a valid PrReviewOutput");if(typeof i.durationMs!="number"||!Number.isFinite(i.durationMs)||i.durationMs<0||!Array.isArray(i.taskIds)||i.taskIds.length<3)throw new Error("accepted review report has no valid workflow timing");if(i.summarizedPaths!==void 0&&(!Array.isArray(i.summarizedPaths)||i.summarizedPaths.some(p=>typeof p!="string")))throw new Error("invalid summarized evidence paths");return await t.upsertComment(e.prNumber,b({revision:e.reviewedRevision,runUrl:e.runUrl,taskId:e.taskId,durationMs:i.durationMs,domainCount:i.taskIds.length-2,summarizedPaths:i.summarizedPaths,output:u})),"published"}async function a(){const{values:e}=h({options:{mode:{type:"string"},repo:{type:"string"},pr:{type:"string"},revision:{type:"string"},"run-url":{type:"string"},"task-id":{type:"string"},"review-succeeded":{type:"boolean",default:!1},"result-path":{type:"string"},author:{type:"string"}}});if(e.mode!=="start"&&e.mode!=="publish"||!e.repo||!e.pr||!e.revision||!e["run-url"]||!e.author)throw new Error("Usage: complexity-review-comment --mode start|publish --repo owner/repo --pr N --revision SHA --run-url URL");const t=Number(e.pr);if(!Number.isInteger(t)||t<1)throw new Error("--pr must be a positive integer");const r=l(),i=await I({mode:e.mode,repo:e.repo,prNumber:t,reviewedRevision:e.revision,runUrl:e["run-url"],token:r,author:e.author,taskId:e["task-id"],reviewSucceeded:e["review-succeeded"],resultPath:e["result-path"]});process.stdout.write(`${JSON.stringify({status:i})}
`)}process.argv[1]&&import.meta.url===v(process.argv[1]).href&&a().catch(e=>{console.error("[fatal]",e instanceof Error?e.message:e),process.exitCode=1});a().catch(e=>{console.error(e),process.exitCode=1});
