import {Grant, IGrantable} from 'aws-cdk-lib/aws-iam';
import {Stack} from 'aws-cdk-lib';
import {Construct} from 'constructs';

/**
 * Represents a group of SSM Parameter paths.
 */
export class ParameterPaths {
  private readonly stack: Stack;
  readonly paths: string[];

  constructor(scope: Construct, ...paths: string[]) {
    this.stack = Stack.of(scope);
    paths.forEach((path) => this.validatePath(path));
    this.paths = paths;
  }

  protected validatePath(path: string) {
    if (!path.startsWith('/')) {
      throw new Error("path must start with a '/'");
    }
  }

  grantDescribe(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions: ['ssm:DescribeParameters'],
      resourceArns: ['*'],
    });
  }

  grantRead(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
        'ssm:GetParameterHistory',
      ],
      resourceArns: this.paths.map(
        (path) =>
          `arn:aws:ssm:${this.stack.region}:${this.stack.account}:parameter${path}`,
      ),
    });
  }

  grantWrite(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions: [
        'ssm:PutParameter',
        'ssm:DeleteParameter',
        'ssm:DeleteParameters',
      ],
      resourceArns: this.paths.map(
        (path) =>
          `arn:aws:ssm:${this.stack.region}:${this.stack.account}:parameter${path}`,
      ),
    });
  }

  grantReadWrite(grantee: IGrantable): Grant {
    return Grant.addToPrincipal({
      grantee,
      actions: [
        'ssm:GetParameter',
        'ssm:GetParameters',
        'ssm:GetParametersByPath',
        'ssm:GetParameterHistory',
        'ssm:PutParameter',
        'ssm:DeleteParameter',
        'ssm:DeleteParameters',
      ],
      resourceArns: this.paths.map(
        (path) =>
          `arn:aws:ssm:${this.stack.region}:${this.stack.account}:parameter${path}`,
      ),
    });
  }
}
