# Core React Hooks Rules

This document covers the two essential React Hooks rules that form the foundation of the eslint-plugin-react-hooks package.

## Rules of Hooks Rule

Enforces that React Hooks are only called at the top level of React functions and not inside loops, conditions, or nested functions.

```typescript { .api }
const RulesOfHooksRule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'enforces the Rules of Hooks',
      recommended: true,
      url: 'https://react.dev/reference/rules/rules-of-hooks'
    }
  },
  create(context: RuleContext): NodeVisitor
};
```

### Configuration

```javascript
{
  "rules": {
    "react-hooks/rules-of-hooks": "error"
  }
}
```

### What It Checks

- Hooks are only called from React function components
- Hooks are only called from custom Hooks (functions starting with "use")
- Hooks are not called inside loops, conditions, or nested functions
- Hooks are called in the same order every time

### Valid Examples

```javascript
// ✅ Valid: Hook called at top level of component
function MyComponent() {
  const [state, setState] = useState(0);
  useEffect(() => {
    // Effect logic
  });
  return <div>{state}</div>;
}

// ✅ Valid: Hook called at top level of custom hook
function useCustomHook() {
  const [state, setState] = useState(0);
  return state;
}

// ✅ Valid: Hook called in component returned by HOC
function createComponent() {
  return function Component() {
    const [state, setState] = useState(0);
    return <div>{state}</div>;
  };
}
```

### Invalid Examples

```javascript
// ❌ Invalid: Hook called conditionally
function MyComponent({ condition }) {
  if (condition) {
    const [state, setState] = useState(0); // Error!
  }
}

// ❌ Invalid: Hook called in loop
function MyComponent({ items }) {
  const states = [];
  for (const item of items) {
    states.push(useState(item)); // Error!
  }
}

// ❌ Invalid: Hook called in regular function
function regularFunction() {
  const [state, setState] = useState(0); // Error!
}
```

## Exhaustive Dependencies Rule

Verifies that all dependencies of Hooks like useEffect, useMemo, and useCallback are included in their dependency arrays.

```typescript { .api }
const ExhaustiveDepsRule: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'verifies the list of dependencies for Hooks like useEffect and similar',
      recommended: true,
      url: 'https://github.com/facebook/react/issues/14920'
    },
    fixable: 'code',
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          additionalHooks: {
            type: 'string'
          }
        }
      }
    ]
  },
  create(context: RuleContext): NodeVisitor
};
```

### Configuration

```javascript
{
  "rules": {
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

### Advanced Configuration

Configure custom hooks that should be validated:

```javascript { .api }
interface ExhaustiveDepsOptions {
  additionalHooks?: string; // RegExp pattern for custom hooks
  enableDangerousAutofixThisMayCauseInfiniteLoops?: boolean; // Enable legacy autofix
  experimental_autoDependenciesHooks?: string[]; // Experimental auto-dependency hooks
  requireExplicitEffectDeps?: boolean; // Require explicit dependency arrays
}
```

```javascript
{
  "rules": {
    "react-hooks/exhaustive-deps": ["warn", {
      "additionalHooks": "(useMyCustomHook|useMyOtherCustomHook)"
    }]
  }
}
```

### What It Checks

- useEffect dependencies include all values from component scope that are used inside the effect
- useMemo dependencies include all values used in the computation
- useCallback dependencies include all values used in the callback
- Custom hooks (specified in additionalHooks) have correct dependencies

### Valid Examples

```javascript
// ✅ Valid: All dependencies included
function MyComponent({ userId }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, [userId]); // userId is included in dependencies

  const memoizedValue = useMemo(() => {
    return expensiveCalculation(user);
  }, [user]); // user is included in dependencies

  const handleClick = useCallback(() => {
    console.log(user.name);
  }, [user]); // user is included in dependencies
}

// ✅ Valid: Empty dependencies for effect that doesn't use any values
function MyComponent() {
  useEffect(() => {
    const timer = setInterval(() => {
      console.log('tick');
    }, 1000);
    return () => clearInterval(timer);
  }, []); // No dependencies needed
}
```

### Invalid Examples

```javascript
// ❌ Invalid: Missing dependency
function MyComponent({ userId }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetchUser(userId).then(setUser);
  }, []); // Error: userId should be in dependencies
}

// ❌ Invalid: Stale closure
function MyComponent() {
  const [count, setCount] = useState(0);

  const handleClick = useCallback(() => {
    console.log(count); // This will always log the initial value
  }, []); // Error: count should be in dependencies
}

// ❌ Invalid: Unnecessary dependency
function MyComponent() {
  const [count, setCount] = useState(0);
  const stableValue = 42;

  useEffect(() => {
    console.log(count);
  }, [count, stableValue]); // Error: stableValue is not needed
}
```

### Auto-fix Support

The exhaustive-deps rule provides automatic fixes for common dependency issues:

- **Add missing dependencies**: Automatically adds missing values to dependency arrays
- **Remove unnecessary dependencies**: Removes stable values that don't need to be dependencies
- **Suggest dependency updates**: Provides suggestions for complex dependency scenarios

### Custom Hook Integration

For custom hooks that follow the same dependency patterns:

```javascript
// Custom hook that should be validated
function useCustomEffect(callback, deps) {
  useEffect(callback, deps);
}

// Configuration to validate this custom hook
{
  "rules": {
    "react-hooks/exhaustive-deps": ["warn", {
      "additionalHooks": "useCustomEffect"
    }]
  }
}
```

## Rule Helper Types

```typescript { .api }
// Hook detection utilities
function isHookName(name: string): boolean;
function isHook(node: Node): boolean;
function isReactFunction(node: Node): boolean;

// Dependency analysis types
interface DeclaredDependency {
  key: string;
  node: Node;
}

interface Dependency {
  isStable: boolean;
  references: Array<Scope.Reference>;
}

interface DependencyTreeNode {
  isUsed: boolean;
  isSatisfiedRecursively: boolean;
  isSubtreeUsed: boolean;
  children: Map<string, DependencyTreeNode>;
}
```
