A teammate opened a small PR with this helper and asked whether it's safe to merge:

```js
// Returns true only if EVERY number in the list is positive.
function allPositive(nums) {
  return nums.some((n) => n > 0);
}
```

Review it and tell me your verdict: is it safe to merge, and why or why not?
