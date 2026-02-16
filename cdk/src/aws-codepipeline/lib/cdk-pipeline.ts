import {Construct} from 'constructs';
import {
  CfnPipeline,
  Pipeline,
  PipelineType,
} from 'aws-cdk-lib/aws-codepipeline';
import {Key} from 'aws-cdk-lib/aws-kms';
import {ArtifactBucket} from './artifact-bucket';
import {
  AddStageOpts,
  CodePipeline,
  CodePipelineSource,
  IFileSetProducer,
  ShellStep,
  StageDeployment,
  Wave,
  WaveOptions,
} from 'aws-cdk-lib/pipelines';
import {
  BuildSpec,
  ComputeType,
  IBuildImage,
  LinuxBuildImage,
} from 'aws-cdk-lib/aws-codebuild';
import {PipelineNotificationRule} from './pipeline-notification-rule';
import {Arn, Stack, Stage} from 'aws-cdk-lib';
import {Repository} from 'aws-cdk-lib/aws-codecommit';
import {NodePackageManager} from './enums';
import {Effect, PolicyStatement} from 'aws-cdk-lib/aws-iam';
import {ISlackChannelConfiguration} from 'aws-cdk-lib/aws-chatbot';
import {ITopic} from 'aws-cdk-lib/aws-sns';

/**
 * Node runtimes supported by CodebBuild
 * See https://docs.aws.amazon.com/codebuild/latest/userguide/available-runtimes.html
 */
export enum NodeVersion {
  NODE_16 = '16',
  NODE_18 = '18',
  NODE_20 = '20',
  NODE_22 = '22',
  NODE_24 = '24',
}

/**
 * Go runtimes supported by CodeBuild
 * See https://docs.aws.amazon.com/codebuild/latest/userguide/available-runtimes.html
 */
export enum GoVersion {
  GO_1_12 = '1.12',
  GO_1_13 = '1.13',
  GO_1_14 = '1.14',
  GO_1_15 = '1.15',
  GO_1_16 = '1.16',
  GO_1_17 = '1.17',
  GO_1_18 = '1.18',
  GO_1_20 = '1.20',
  GO_1_21 = '1.21',
  GO_1_22 = '1.22',
  GO_1_23 = '1.23',
  GO_1_24 = '1.24',
}

/**
 * Java runtimes supported by CodeBuild
 * See https://docs.aws.amazon.com/codebuild/latest/userguide/available-runtimes.html
 */
export enum JavaVersion {
  JAVA_8 = 'corretto8',
  JAVA_11 = 'corretto11',
  JAVA_16 = 'corretto17',
  JAVA_21 = 'corretto21',
}

/**
 * Dotnet runtimes supported by CodeBuild
 * See https://docs.aws.amazon.com/codebuild/latest/userguide/available-runtimes.htmldotnet
 */
export enum DotnetVersion {
  DOTNET_3_1 = '3.1',
  DOTNET_5_0 = '5.0',
  DOTNET_6_0 = '6.0',
  DOTNET_8_0 = '8.0',
}

export enum PythonVersion {
  PYTHON_3_7 = '3.7',
  PYTHON_3_8 = '3.8',
  PYTHON_3_9 = '3.9',
  PYTHON_3_10 = '3.10',
  PYTHON_3_11 = '3.11',
  PYTHON_3_12 = '3.12',
  PYTHON_3_13 = '3.13',
}

const DOCKER_BUILDX_SETUP_COMMANDS = [
  "echo '#!/bin/bash' > /usr/local/bin/buildx.sh",
  'echo \'[[ "$1" == "build" ]] && docker buildx build --load "${@:2}" || docker "$@"\' >> /usr/local/bin/buildx.sh',
  'chmod +x /usr/local/bin/buildx.sh',
  'echo "Architecture: $(uname -m)"',
  'docker buildx create --use --name multi-arch-builder',
  'docker buildx ls',
];

/**
 * Properties for CdkPipeline
 */
export interface CdkPipelineProps {
  /**
   * By default, CDK will name the pipeline. Set this to override the name.
   */
  readonly pipelineName?: string;

  readonly pipelineType?: PipelineType;

  /**
   * By default, CDK will create KMS keys for cross account deployments. This
   * can be costly if you have a large number of pipelines. This property
   * allows a common key to be shared across pipelines.
   *
   * You must change @aws-cdk/aws-codepipeline:crossAccountKeysDefaultValueToFalse to false in your cdk.json
   * file to avoid errors.
   */
  readonly keyArn: string;

  /**
   * List of account IDs this pipeline will deploy into.
   */
  readonly accountIds?: string[];

  /**
   * Arn of the CodeStar connection used to access the source code repository. If not set, this
   * construct assumes the repository is in AWS CodeCommit.
   */
  readonly connectionArn?: string;

  /**
   * Source code repository.
   */
  readonly repository: string;

  /**
   * Branch to use inside the source code repository.
   */
  readonly branch: string;

  /**
   * Enable or disable self-mutation. Useful for cdk pipeline development.
   *
   * @default true
   */
  readonly selfMutation?: boolean;

  /**
   * Enable docker for the 'synth' step.
   *
   * @default true
   */
  readonly dockerEnabledForSynth?: boolean;

  /**
   * Enable docker for the self-mutate step.
   *
   * @default true
   */
  readonly dockerEnabledForSelfMutation?: boolean;

  /**
   * Type of compute to use for this build. Default is ComputeType.SMALL.
   */
  readonly computeType?: ComputeType;

  /**
   * The image to use for builds. If none is selected the default defined in AWS CDK is used.
   */
  readonly buildImage?: IBuildImage;

  /**
   * The ARN of the Slack channel configuration to use for notifications. Mutually exclusive with slackChannelConfiguration.
   */
  readonly slackChannelConfigurationArn?: string;

  /**
   * The Slack channel configuration to use for notifications. Mutually exclusive with slackChannelConfigurationArn.
   */
  readonly slackChannelConfiguration?: ISlackChannelConfiguration;

  /**
   * The SNS topic to use for notifications. Mutually exclusive with notificationTopic.
   */
  readonly notificationTopicArn?: string;

  /**
   * The SNS topic to use for notifications. Mutually exclusive with notificationTopicArn.
   */
  readonly notificationTopic?: ITopic;

  /**
   * The list of notification events to receive.Default is DEFAULT_EVENTS
   * @see https://docs.aws.amazon.com/dtconsole/latest/userguide/concepts.html#events-ref-pipeline
   */
  readonly notificationEvents?: string[];

  /**
   * Additional FileSets to put in other directories
   */
  readonly additionalInputs?: Record<string, IFileSetProducer>;

  /**
   * Additional commands to run before install. If you override the commands property, this has no effect.
   */
  readonly preBuildCommands?: string[];

  /**
   * Overrides default commands.
   */
  readonly commands?: string[];

  /**
   * Public assets in multiple CodeBuild projects. Default is false.
   */
  readonly publishAssetsInParallel?: boolean;

  /**
   * Package manager to use when executing CDK.
   *
   * @default NodePackageManager.PNPM
   */
  readonly packageManager?: NodePackageManager;

  /**
   * The directory the CDK project is located in the repo.
   *
   * @default - "."
   */
  readonly cdkDirectory?: string;

  /**
   * Policy statements to add to the role used by synth.
   */
  readonly rolePolicy?: PolicyStatement[];

  /**
   * Grants read access to the provided AWS CodeArtifact domains.
   */
  readonly codeArtifactDomains?: string[];

  /**
   * Grants read access to the provided AWS CodeArtifact repositories.
   */
  readonly codeArtifactRepositories?: string[];

  /**
   * Version of Node to use in the pipeline. Default is NODE_20
   */
  readonly nodeVersion?: NodeVersion | string;

  /**
   * Version of Go to install. Default is none.
   */
  readonly goVersion?: GoVersion | string;

  /**
   * Version of Java to install. Default is none.
   */
  readonly javaVersion?: JavaVersion | string;

  /**
   * Version of Dotnet to install. Default is none.
   */
  readonly dotnetVersion?: DotnetVersion | string;

  /**
   * Version of Python to install. Default is none.
   */
  readonly pythonVersion?: PythonVersion | string;

  /**
   * Additional commands to run during the install phase.
   */
  readonly additionalInstallCommands?: string[];

  /**
   * Whether to clone the CodeCommit repository into the CodeBuild project.
   */
  readonly codeBuildCloneOutput?: boolean;

  /**
   * Enables the use of "docker buildx" in the asset publishing step. Default is true.
   */
  readonly enableDockerBuildxOnAssetPublish?: boolean;

  /**
   * Disable automatic triggering on source code changes. When true, the pipeline
   * must be manually started. Useful for development environments.
   *
   * @default false (auto-trigger enabled)
   */
  readonly disableAutoTrigger?: boolean;
}

/**
 * An abstraction to ease CDK pipeline creation and configuration.
 */
export class CdkPipeline extends Construct {
  readonly pipeline: CodePipeline;
  readonly pipelineNotificationRule?: PipelineNotificationRule;

  constructor(scope: Construct, id: string, props: CdkPipelineProps) {
    super(scope, id);

    const encryptionKey = Key.fromKeyArn(this, 'EncryptionKey', props.keyArn);

    const artifactBucket = new ArtifactBucket(this, 'ArtifactBucket', {
      encryptionKey,
      accountIds: props.accountIds,
    });

    const underlyingPipeline = new Pipeline(this, 'Pipeline', {
      pipelineType: props.pipelineType ?? PipelineType.V2,
      artifactBucket,
      pipelineName: props.pipelineName,
    });

    let input: CodePipelineSource;
    if (props.connectionArn !== undefined) {
      input = CodePipelineSource.connection(props.repository, props.branch, {
        connectionArn: props.connectionArn,
        // Used per workaround in https://github.com/aws/aws-cdk/issues/11399#issuecomment-1367180696
        codeBuildCloneOutput: props.codeBuildCloneOutput ?? false,
      });
    } else {
      const repository = props.repository.startsWith('arn:')
        ? Repository.fromRepositoryArn(this, 'Repository', props.repository)
        : Repository.fromRepositoryName(this, 'Repository', props.repository);
      input = CodePipelineSource.codeCommit(repository, props.branch, {
        // Used per workaround in https://github.com/aws/aws-cdk/issues/11399#issuecomment-1367180696
        codeBuildCloneOutput: props.codeBuildCloneOutput ?? false,
      });
    }

    const stackName = Stack.of(this).stackName;
    const cdkDirectory = props.cdkDirectory ?? '.';

    let commands: string[] | undefined = props.commands;
    if (
      commands === undefined &&
      props.packageManager === NodePackageManager.PNPM
    ) {
      commands = [
        `cd ${cdkDirectory ?? '.'}`,
        'npm -g i pnpm',
        'pnpm i --frozen-lockfile --prefer-offline',
        ...(props.preBuildCommands ?? []),
        'pnpm run build',
        'pnpm run test',
        `pnpx cdk synth ${stackName}`,
      ];
    } else if (commands === undefined) {
      commands = [
        `cd ${cdkDirectory ?? '.'}`,
        'npm ci --prefer-offline',
        ...(props.preBuildCommands ?? []),
        'npm run build',
        'npm run test',
        `npx cdk synth ${stackName}`,
      ];
    }

    const stack = Stack.of(this);

    const codeArtifactDomains = props.codeArtifactDomains?.map((domain) => {
      return domain.startsWith('arn:aws')
        ? domain
        : Arn.format(
            {
              service: 'codeartifact',
              resource: 'domain',
              resourceName: domain,
            },
            stack,
          );
    });

    const codeArtifactRepositories = props.codeArtifactRepositories?.map(
      (repository) => {
        return repository.startsWith('arn:aws')
          ? repository
          : Arn.format(
              {
                service: 'codeartifact',
                resource: 'repository',
                resourceName: repository,
              },
              stack,
            );
      },
    );

    const rolePolicy = props.rolePolicy ?? [];
    if (codeArtifactDomains) {
      rolePolicy.push(
        new PolicyStatement({
          resources: codeArtifactDomains,
          actions: ['codeartifact:GetAuthorizationToken'],
          effect: Effect.ALLOW,
        }),
      );
      rolePolicy.push(
        new PolicyStatement({
          resources: ['*'],
          actions: ['sts:GetServiceBearerToken'],
          effect: Effect.ALLOW,
        }),
      );
    }
    if (codeArtifactRepositories) {
      rolePolicy.push(
        new PolicyStatement({
          resources: codeArtifactRepositories,
          actions: [
            'codeartifact:DescribePackageVersion',
            'codeartifact:DescribeRepository',
            'codeartifact:GetPackageVersionReadme',
            'codeartifact:GetRepositoryEndpoint',
            'codeartifact:ListPackages',
            'codeartifact:ListPackageVersions',
            'codeartifact:ListPackageVersionAssets',
            'codeartifact:ListPackageVersionDependencies',
            'codeartifact:ReadFromRepository',
          ],
          effect: Effect.ALLOW,
        }),
      );
    }

    this.pipeline = new CodePipeline(this, 'CodePipeline', {
      codePipeline: underlyingPipeline,
      selfMutation: props.selfMutation ?? true,
      dockerEnabledForSynth: props.dockerEnabledForSynth ?? true,
      dockerEnabledForSelfMutation: props.dockerEnabledForSelfMutation ?? true,
      publishAssetsInParallel: props.publishAssetsInParallel ?? false,
      synth: new ShellStep('Synth', {
        primaryOutputDirectory: `${cdkDirectory}/cdk.out`,
        input,
        commands,
        additionalInputs: props.additionalInputs ?? {},
      }),
      synthCodeBuildDefaults: {
        partialBuildSpec: BuildSpec.fromObject({
          cache: {
            paths: ['/root/.npm/**/*', '/root/.pnpm-store/**/*'],
          },
          phases: {
            install: {
              'runtime-versions': {
                nodejs: props.nodeVersion ?? NodeVersion.NODE_24,
                go: props.goVersion,
                java: props.javaVersion,
                dotnet: props.dotnetVersion,
                python: props.pythonVersion,
              },
              'commands': ['npm config set fund false', 'npm -g i esbuild']
                .concat(props.additionalInstallCommands ?? [])
                .concat(['node --version']),
            },
          },
        }),
        buildEnvironment: {
          privileged: true,
          computeType: props.computeType ?? ComputeType.SMALL,
          buildImage: props.buildImage ?? LinuxBuildImage.AMAZON_LINUX_2_5,
        },
        rolePolicy,
      },
      assetPublishingCodeBuildDefaults: {
        partialBuildSpec: BuildSpec.fromObject({
          env: {
            variables: {
              ...((props.enableDockerBuildxOnAssetPublish ?? true)
                ? {CDK_DOCKER: '/usr/local/bin/buildx.sh'}
                : {}),
            },
          },
          phases: {
            install: {
              commands:
                (props.enableDockerBuildxOnAssetPublish ?? true)
                  ? DOCKER_BUILDX_SETUP_COMMANDS
                  : [],
            },
          },
        }),
      },
    });

    // Disable automatic triggering if requested
    if (props.disableAutoTrigger) {
      const cfnPipeline = underlyingPipeline.node.defaultChild as CfnPipeline;
      cfnPipeline.addPropertyOverride(
        'Stages.0.Actions.0.Configuration.TriggerConfiguration',
        {
          ProviderType: 'CodeStarSourceConnection',
          TriggerEvents: 'NONE',
        },
      );
    }

    // Handle pipeline notifications
    if (props.slackChannelConfiguration && props.slackChannelConfigurationArn) {
      throw new Error(
        'Only one of slackChannelConfiguration and slackChannelConfigurationArn can be specified',
      );
    }
    if (props.notificationTopic && props.notificationTopicArn) {
      throw new Error(
        'Only one of notificationTopic and notificationTopicArn can be specified',
      );
    }
    if (
      props.slackChannelConfiguration ||
      props.slackChannelConfigurationArn ||
      props.notificationTopicArn ||
      props.notificationTopic
    ) {
      this.pipelineNotificationRule = new PipelineNotificationRule(
        this,
        'Notification',
        {
          events: props.notificationEvents,
          source: underlyingPipeline,
        },
      );
      if (props.slackChannelConfiguration) {
        this.pipelineNotificationRule.addSlackChannel(
          props.slackChannelConfiguration,
        );
      } else if (props.slackChannelConfigurationArn) {
        this.pipelineNotificationRule.addSlackChannelArn(
          'SlackChannel',
          props.slackChannelConfigurationArn,
        );
      }
      if (props.notificationTopic) {
        this.pipelineNotificationRule.addTopic(props.notificationTopic);
        props.notificationTopic.grantPublish(underlyingPipeline.role);
      } else if (props.notificationTopicArn) {
        const topic = this.pipelineNotificationRule.addTopicArn(
          'NotificationTopic',
          props.notificationTopicArn,
        );
        topic.grantPublish(underlyingPipeline.role);
      }
    }
  }

  addStage(stage: Stage, options?: AddStageOpts): StageDeployment {
    return this.pipeline.addStage(stage, options);
  }

  addWave(id: string, options?: WaveOptions): Wave {
    return this.pipeline.addWave(id, options);
  }
}
