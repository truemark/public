# TrueMark CDK Extra JS

TypeScript and JavaScript only companions to [truemark-cdk-lib](../cdk/README.md).

`truemark-cdk-lib` is built with [jsii](https://aws.github.io/jsii/) so it can be used from other
languages. That rules out some TypeScript features, such as generics and mapped types like
`Omit` and `Partial`. Constructs that need those features live here instead.

| Export | Import from | Why it is not in truemark-cdk-lib |
|---|---|---|
| `SingleStackStage`, `WrapperStageProps` | `truemark-cdk-extra-js/aws-cdk` | Generic over the stack class and takes the class itself as a property |
| `StandardTable`, `StandardTableProps` | `truemark-cdk-extra-js/aws-dynamodb` | Properties are `Omit<TableProps, ...>` and `addGlobalSecondaryIndex` narrows the inherited signature |
| `StandardTableV2`, `StandardTablePropsV2` | `truemark-cdk-extra-js/aws-dynamodb` | Same as `StandardTable` |

```typescript
import {StandardTable} from 'truemark-cdk-extra-js/aws-dynamodb';
```

`truemark-cdk-lib`, `aws-cdk-lib` and `constructs` are peer dependencies.
