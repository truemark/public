import {ResourceType, HelperTest} from '../../helper.test';
import {
  DataClassification,
  DataSensitivity,
  ExtendedApp,
  ExtendedConstruct,
  ExtendedStack,
  ExtendedStage,
} from '../index';
import {Construct} from 'constructs';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {Bucket} from 'aws-cdk-lib/aws-s3';
import * as oam from 'aws-cdk-lib/aws-oam';

class TestSubConstruct extends ExtendedConstruct {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      standardTags: {
        automationComponentTags: {
          id: 'TestSubConstruct',
          url: 'https://testsubconstruct.com',
        },
      },
    });
    new Bucket(this, 'TestSubBucket');
  }
}

class TestConstruct extends ExtendedConstruct {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      standardTags: {
        automationComponentTags: {
          id: 'TestConstruct',
          url: 'https://testconstruct.com',
        },
      },
    });
    new Bucket(this, 'TestBucket');
    new TestSubConstruct(this, 'TestSubConstruct');
    // Tags.of(this).add("bark", "meow");
  }
}

class TestStack extends ExtendedStack {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      standardTags: {
        automationComponentTags: {
          id: 'TestStack',
          url: 'https://teststack.com',
        },
      },
    });
    new TestConstruct(this, 'TestConstruct');
  }
}

interface TestStageProps {
  readonly environment: string;
}

class TestStage extends ExtendedStage {
  readonly stack: TestStack;
  constructor(scope: Construct, id: string, props: TestStageProps) {
    super(scope, id, {
      standardTags: {
        costCenterTags: {
          environment: props.environment,
        },
      },
    });
    this.stack = new TestStack(this, 'TestStack');
  }
}

class TestApp extends ExtendedApp {
  constructor() {
    super({
      account: HelperTest.DEFAULT_ACCOUNT,
      region: HelperTest.DEFAULT_REGION,
      standardTags: {
        mapMigrated: 'mig12345',
        automationTags: {
          id: 'TestApp',
          url: 'https://testapp.com',
        },
        costCenterTags: {
          projectName: 'TestApp',
          projectId: 'test-app',
          environment: 'test',
          contactName: 'John Doe',
          contactEmail: 'jdoe@example.com',
          contactPhone: '+1 555-555-5555',
          businessUnitName: 'Test Unit',
          businessUnitId: 'test-unit',
          divisionName: 'Test Division',
          divisionId: 'test-division',
          departmentName: 'Test Department',
          departmentId: 'test-department',
        },
        securityTags: {
          dataClassification: DataClassification.Restricted,
          dataSensitivity: DataSensitivity.PII,
        },
        teamTags: {
          name: 'Test Team',
          id: 'test-team',
          contactName: 'John Doe',
          contactEmail: 'jdoe@example.com',
          contactPhone: '+1 555-555-5555',
          businessUnitName: 'Test Unit',
          businessUnitId: 'test-unit',
          divisionName: 'Test Division',
          divisionId: 'test-division',
          departmentName: 'Test Department',
          departmentId: 'test-department',
        },
      },
    });
  }
}

test('Test StandardTags', () => {
  const app = new TestApp();
  const testStage = new TestStage(app, 'TestStage', {
    environment: 'test',
  });
  const prodStage = new TestStage(app, 'ProdStage', {
    environment: 'prod',
  });
  const testTemplate = Template.fromStack(testStage.stack);
  testTemplate.resourceCountIs(ResourceType.S3_BUCKET, 2);
  testTemplate.hasResourceProperties(ResourceType.S3_BUCKET, {
    Tags: Match.arrayWith([
      {
        Key: 'map-migrated',
        Value: 'mig12345',
      },
    ]),
  });
  const prodTemplate = Template.fromStack(prodStage.stack);
  prodTemplate.resourceCountIs(ResourceType.S3_BUCKET, 2);
});

test('Test Global Exclusion', () => {
  const app = new TestApp();
  const stack = new ExtendedStack(app, 'SomeStack');
  new oam.CfnLink(stack, 'SomeLink', {
    resourceTypes: [ResourceType.CLOUDWATCH_ALARM],
    sinkIdentifier: 'sink',
  });
  const template = Template.fromStack(stack);
  template.hasResource(ResourceType.OAM_LINK, {
    Properties: {
      Tags: Match.absent(),
    },
  });
});
