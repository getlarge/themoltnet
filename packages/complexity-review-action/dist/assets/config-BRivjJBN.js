function r(){const n=process.env.GITHUB_TOKEN?.trim();if(!n)throw new Error("GITHUB_TOKEN is required");return n}function e(){return process.env}export{r as n,e as t};
