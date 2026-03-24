# React Compiler Rules

This document covers the 27 React Compiler rules integrated into eslint-plugin-react-hooks, providing advanced static analysis for React applications with performance optimization and enhanced code quality validation.

## Overview

React Compiler rules are automatically imported from `babel-plugin-react-compiler` and provide static analysis beyond basic Hooks validation. These rules help optimize React applications by enforcing patterns that work well with React's compiler optimizations.

```typescript { .api }
// React Compiler rule integration
import {
  allRules,
  recommendedRules,
  mapErrorSeverityToESlint,
} from './shared/ReactCompiler';

const compilerRules = Object.fromEntries(
  Object.entries(allRules).map(([name, config]) => [name, config.rule]),
);
```

## Complete Rule List

The React Compiler ESLint plugin imports **26 core rules** from `babel-plugin-react-compiler` via the `LintRules` export, plus one additional rule (`no-unused-directives`) for a total of **27 rules**.

### Recommended Rules (15 rules)

These rules are included in the recommended configuration and focus on core React patterns and performance.

#### **`component-hook-factories`** (Error severity, **recommended**)

```typescript { .api }
const componentHookFactoriesRule: Rule.RuleModule;
```

- **Category**: Factories
- **Purpose**: Validates against higher order functions defining nested components or hooks. Components and hooks should be defined at the module level

#### **`config`** (Error severity, **recommended**)

```typescript { .api }
const configRule: Rule.RuleModule;
```

- **Category**: Config
- **Purpose**: Validates the compiler configuration options

#### **`error-boundaries`** (Error severity, **recommended**)

```typescript { .api }
const errorBoundariesRule: Rule.RuleModule;
```

- **Category**: ErrorBoundaries
- **Purpose**: Validates usage of error boundaries instead of try/catch for errors in child components

#### **`gating`** (Error severity, **recommended**)

```typescript { .api }
const gatingRule: Rule.RuleModule;
```

- **Category**: Gating
- **Purpose**: Validates configuration of [gating mode](https://react.dev/reference/react-compiler/gating)

#### **`globals`** (Error severity, **recommended**)

```typescript { .api }
const globalsRule: Rule.RuleModule;
```

- **Category**: Globals
- **Purpose**: Validates against assignment/mutation of globals during render, part of ensuring that [side effects must render outside of render](https://react.dev/reference/rules/components-and-hooks-must-be-pure#side-effects-must-run-outside-of-render)

#### **`immutability`** (Error severity, **recommended**)

```typescript { .api }
const immutabilityRule: Rule.RuleModule;
```

- **Category**: Immutability
- **Purpose**: Validates against mutating props, state, and other values that [are immutable](https://react.dev/reference/rules/components-and-hooks-must-be-pure#props-and-state-are-immutable)

#### **`incompatible-library`** (Warning severity, **recommended**)

```typescript { .api }
const incompatibleLibraryRule: Rule.RuleModule;
```

- **Category**: IncompatibleLibrary
- **Purpose**: Validates against usage of libraries which are incompatible with memoization (manual or automatic)

#### **`no-unused-directives`** (Error severity, **recommended**)

```typescript { .api }
const noUnusedDirectivesRule: Rule.RuleModule;
```

- **Purpose**: Validates against unused opt-out directives
- **Note**: This is an additional plugin rule, not from ErrorCategory

#### **`preserve-manual-memoization`** (Error severity, **recommended**)

```typescript { .api }
const preserveManualMemoizationRule: Rule.RuleModule;
```

- **Category**: PreserveManualMemo
- **Purpose**: Validates that existing manual memoization is preserved by the compiler. React Compiler will only compile components and hooks if its inference [matches or exceeds the existing manual memoization](https://react.dev/learn/react-compiler/introduction#what-should-i-do-about-usememo-usecallback-and-reactmemo)

#### **`purity`** (Error severity, **recommended**)

```typescript { .api }
const purityRule: Rule.RuleModule;
```

- **Category**: Purity
- **Purpose**: Validates that [components/hooks are pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure) by checking that they do not call known-impure functions

#### **`refs`** (Error severity, **recommended**)

```typescript { .api }
const refsRule: Rule.RuleModule;
```

- **Category**: Refs
- **Purpose**: Validates correct usage of refs, not reading/writing during render. See the "pitfalls" section in [`useRef()` usage](https://react.dev/reference/react/useRef#usage)

#### **`set-state-in-effect`** (Error severity, **recommended**)

```typescript { .api }
const setStateInEffectRule: Rule.RuleModule;
```

- **Category**: EffectSetState
- **Purpose**: Validates against calling setState synchronously in an effect, which can lead to re-renders that degrade performance

#### **`set-state-in-render`** (Error severity, **recommended**)

```typescript { .api }
const setStateInRenderRule: Rule.RuleModule;
```

- **Category**: RenderSetState
- **Purpose**: Validates against setting state during render, which can trigger additional renders and potential infinite render loops

#### **`static-components`** (Error severity, **recommended**)

```typescript { .api }
const staticComponentsRule: Rule.RuleModule;
```

- **Category**: StaticComponents
- **Purpose**: Validates that components are static, not recreated every render. Components that are recreated dynamically can reset state and trigger excessive re-rendering

#### **`unsupported-syntax`** (Warning severity, **recommended**)

```typescript { .api }
const unsupportedSyntaxRule: Rule.RuleModule;
```

- **Category**: UnsupportedSyntax
- **Purpose**: Validates against syntax that we do not plan to support in React Compiler

#### **`use-memo`** (Error severity, **recommended**)

```typescript { .api }
const useMemoRule: Rule.RuleModule;
```

- **Category**: UseMemo
- **Purpose**: Validates usage of the useMemo() hook against common mistakes. See [`useMemo()` docs](https://react.dev/reference/react/useMemo) for more information

### Additional Rules (12 rules)

These rules are available but not included in the recommended configuration.

#### **`automatic-effect-dependencies`** (Error severity, not recommended)

```typescript { .api }
const automaticEffectDependenciesRule: Rule.RuleModule;
```

- **Category**: AutomaticEffectDependencies
- **Purpose**: Verifies that automatic effect dependencies are compiled if opted-in

#### **`capitalized-calls`** (Error severity, not recommended)

```typescript { .api }
const capitalizedCallsRule: Rule.RuleModule;
```

- **Category**: CapitalizedCalls
- **Purpose**: Validates against calling capitalized functions/methods instead of using JSX

#### **`fbt`** (Error severity, not recommended)

```typescript { .api }
const fbtRule: Rule.RuleModule;
```

- **Category**: FBT
- **Purpose**: Validates usage of fbt

#### **`fire`** (Error severity, not recommended)

```typescript { .api }
const fireRule: Rule.RuleModule;
```

- **Category**: Fire
- **Purpose**: Validates usage of `fire`

#### **`hooks`** (Error severity, not recommended)

```typescript { .api }
const hooksRule: Rule.RuleModule;
```

- **Category**: Hooks
- **Purpose**: Validates the rules of hooks
- **Note**: Currently not recommended as it reimplements the "rules-of-hooks" non-compiler rule

#### **`invariant`** (Error severity, not recommended)

```typescript { .api }
const invariantRule: Rule.RuleModule;
```

- **Category**: Invariant
- **Purpose**: Internal invariants

#### **`memoized-effect-dependencies`** (Error severity, not recommended)

```typescript { .api }
const memoizedEffectDependenciesRule: Rule.RuleModule;
```

- **Category**: EffectDependencies
- **Purpose**: Validates that effect dependencies are memoized

#### **`no-deriving-state-in-effects`** (Error severity, not recommended)

```typescript { .api }
const noDeriveStateInEffectsRule: Rule.RuleModule;
```

- **Category**: EffectDerivationsOfState
- **Purpose**: Validates against deriving values from state in an effect

#### **`rule-suppression`** (Error severity, not recommended)

```typescript { .api }
const ruleSuppressionRule: Rule.RuleModule;
```

- **Category**: Suppression
- **Purpose**: Validates against suppression of other rules

#### **`syntax`** (Error severity, not recommended)

```typescript { .api }
const syntaxRule: Rule.RuleModule;
```

- **Category**: Syntax
- **Purpose**: Validates against invalid syntax

#### **`todo`** (Hint severity, not recommended)

```typescript { .api }
const todoRule: Rule.RuleModule;
```

- **Category**: Todo
- **Purpose**: Unimplemented features

## Rule Configuration

All React Compiler rules support configuration through ESLint rule options:

```typescript { .api }
interface CompilerRuleOptions {
  [key: string]: any; // Validated at runtime with zod
}
```

### Severity Mapping

React Compiler error severities map to ESLint severities:

```typescript { .api }
function mapErrorSeverityToESlint(
  severity: ErrorSeverity,
): Linter.StringSeverity {
  switch (severity) {
    case ErrorSeverity.Error:
      return 'error';
    case ErrorSeverity.Warning:
      return 'warn';
    case ErrorSeverity.Hint:
    case ErrorSeverity.Off:
      return 'off';
  }
}
```

## Usage Examples

### Individual Rule Configuration

```javascript
{
  "rules": {
    "react-hooks/immutability": "error",
    "react-hooks/set-state-in-render": "error",
    "react-hooks/preserve-manual-memoization": "warn"
  }
}
```

### Custom Rule Options

```javascript
{
  "rules": {
    "react-hooks/config": ["error", {
      "gating": true,
      "environment": "development"
    }]
  }
}
```

### Disabling Specific Rules

```javascript
{
  "rules": {
    "react-hooks/unsupported-syntax": "off",
    "react-hooks/incompatible-library": "warn"
  }
}
```

## Rule Categories Summary

- **Total Rules**: 27 (26 from ErrorCategory + 1 additional)
- **Recommended Rules**: 15 rules
- **Error Severity**: 23 rules
- **Warning Severity**: 2 rules (`incompatible-library`, `unsupported-syntax`)
- **Hint Severity**: 1 rule (`todo`)

The rules cover areas including hooks validation, component purity, state management, effect dependencies, memoization preservation, and React-specific best practices for optimal compiler performance.
