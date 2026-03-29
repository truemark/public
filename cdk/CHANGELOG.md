# TrueMark CDK Library Changelog

## 1.22.13
### Patch Changes

- f182ce5: Added AutoBackup construct

## 1.22.12
### Patch Changes

- 3e1c604: Added FunctionLogOptions to StandardPythonFunction
- 7b4b8d3: Updated default python runtime to 3_14

## 1.22.11
### Patch Changes

- ce36da7: Set enableDockerBuildxOnAssetPublish to false when computeType is lambda.

## 1.22.10
### Patch Changes

- f5612d4: Updated cache paths in CdkPipeline

## 1.22.9
### Patch Changes

- 194db9b: Disabled docker when compute type is lambda

## 1.22.8
### Patch Changes

- c4b62e4: Set buildEnvironment for synth in CdkPipeline to allow for lambda usage

## 1.22.7
### Patch Changes

- 342ace9: Fixed privileged setting in CdkPipeline

## 1.22.6
### Patch Changes

- d2230d6: Fixed logic with privileged mode

## 1.22.5
### Patch Changes

- 0619bc4: Set privileged mode to false when compute type is lambda

## 1.22.4
### Patch Changes

- 78ed4ec: Added restartExecutionOnUpdate to CdkPipeline

## 1.22.3
### Patch Changes

- b8f6d52: Replaced triggers with gitPushFilter

## 1.22.2
### Patch Changes

- 14c817f: Added new runtime versions for CdkPipeline

## 1.22.1
### Patch Changes

- c49b7e3: Added tiggers to CodePipeline

## 1.22.0
### Minor Changes

- 5abe56d: Add automatic ALB listener rule priority allocation for StandardApplicationFargateService. Add new construct for ECS Run Tasks StandardFargateRunTask.

## 1.21.8
### Patch Changes

- 6e08dea: Added standard-fargate-runtask

## 1.21.7
### Patch Changes

- 3fcc8aa: Added typesVersions

## 1.21.6
### Patch Changes

- 8891a3e: Fixed module exports

## 1.21.5
### Patch Changes

- 338cf4e: Fixed main and types

## 1.21.4
### Patch Changes

- 10648a2: Added deliveryDelay to StandardQueue

## 1.21.3
### Patch Changes

- cc53d96: Improved regular expression in isPascalCase
- e3e7cc4: Improved regex on isCamelCase

## 1.21.2
### Patch Changes

- 3f5248e: Added cors support to WebsiteBucket

## 1.21.1
### Patch Changes

- 6f95456: Added include to BucketDeploymentConfig
- a412028: Added @changesets/cli and changed to new publishing workflow
