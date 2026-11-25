# TrueMark CDK Library

[![NPM Version][npm-image]][npm-url]

This library provides common constructs and functionality to ease CDK development.

The main objectives of this project is to

- Provide extended constructs that add additional functionality to existing CDK constructs
- Provide standard constructs that are simple to use and adhere to best practices
- Provide constructs for commonly used patterns
- Reduce the amount of boilerplate coding required to work with CDK

## Conventions

- **Standard** Constructs are simplified constructs meant for general use. They follow general best practices and have been given sane optimized defaults.
- **Extended** Constructs are extensions of Constructs in the standard CDK library which add functionality such as logging and monitoring.
- Other Constructs found in this library are crafted CDK constructs for specific common use cases which follow CDK's principle of composition over inheritance.

In general, you should use **Standard** over **Extended** constructs unless they do not fit your use case.

## Other languages

This library is built with [jsii](https://aws.github.io/jsii/), so its constructs can be used from
Python, Java and .NET as well as TypeScript and JavaScript. Go is not offered because
`cdk-monitoring-constructs`, which this library depends on, does not publish a Go module.

```bash
pnpm build        # compiles with jsii and writes the .jsii assembly
pnpm run package  # runs jsii-pacmak and writes the language packages to dist-jsii
```

`pnpm run package` needs the toolchain of each language it builds (Python 3, a JDK with Maven
and the .NET SDK). Limit it to the languages you have with `pnpm run package -t python -t java`.

Everything exported from this library has to follow the
[jsii type system restrictions](https://aws.github.io/jsii/user-guides/lib-author/typescript-restrictions/).
The build fails when it does not. Constructs that cannot follow them, for example those that
rely on generics or mapped types like `Omit`, live in
[truemark-cdk-extra-js](../cdk-extra-js/README.md), which is for TypeScript and JavaScript only.

jsii cannot read pnpm `catalog:` specifiers, so the `peerDependencies` ranges in `package.json`
are written out in full. Keep them in step with the catalog in `pnpm-workspace.yaml`.

## Versioning

This project follows a [semantic versioning](https://semver.org/) pattern.

```
<major>.<minor>.<patch>
```

[npm-url]: https://npmjs.org/package/truemark-cdk-lib
[npm-image]: https://img.shields.io/npm/v/truemark-cdk-lib.svg

## Library supported features

Among other features, this library supports the following features:

1. [CDK Open Telemetry Support](README_OTEL.md)
