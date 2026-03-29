import {Construct} from 'constructs';
import {
  BackupPlan,
  BackupPlanRule,
  BackupResource,
  BackupVault,
} from 'aws-cdk-lib/aws-backup';
import {Duration} from 'aws-cdk-lib';
import {Schedule} from 'aws-cdk-lib/aws-events';
import {ExtendedConstruct, ExtendedStackProps} from '../../aws-cdk';

/**
 * Construct that sets up tag-based automated backups using AWS backup.
 * The backup-policy tag setup by this contract supports the following values:
 *  - default-week
 *  - default-month
 *  - default-quarter
 *  - default-year
 *  - default-7-years
 */
export class AutoBackup extends ExtendedConstruct {
  private daily(days: number): BackupPlanRule {
    return new BackupPlanRule({
      ruleName: 'Daily',
      scheduleExpression: Schedule.cron({
        hour: '5',
        minute: '0',
      }),
      deleteAfter: Duration.days(days),
    });
  }

  private weekly(days: number): BackupPlanRule {
    return new BackupPlanRule({
      ruleName: 'Weekly',
      scheduleExpression: Schedule.cron({
        hour: '5',
        minute: '0',
        weekDay: 'SAT',
      }),
      deleteAfter: Duration.days(days),
    });
  }

  private monthly(days: number): BackupPlanRule {
    return new BackupPlanRule({
      ruleName: 'Monthly',
      scheduleExpression: Schedule.cron({
        day: '1',
        hour: '5',
        minute: '0',
      }),
      moveToColdStorageAfter: Duration.days(30),
      deleteAfter: Duration.days(days),
    });
  }

  private tagSelection(plan: BackupPlan, tagValue: string) {
    plan.addSelection('Selection', {
      resources: [BackupResource.fromTag('backup:policy', tagValue)],
    });
  }

  constructor(scope: Construct, id: string, props: ExtendedStackProps) {
    super(scope, id, props);

    const backupVault = new BackupVault(this, 'Default', {
      backupVaultName: 'AutoBackup',
    });

    const defaultWeek = new BackupPlan(this, 'DefaultWeek', {
      backupVault,
      backupPlanRules: [this.daily(7)],
    });
    this.tagSelection(defaultWeek, 'default-week');

    const defaultMonth = new BackupPlan(this, 'DefaultMonth', {
      backupVault,
      backupPlanRules: [this.daily(35)],
    });
    this.tagSelection(defaultMonth, 'default-month');

    const defaultQuarter = new BackupPlan(this, 'DefaultQuarter', {
      backupVault,
      backupPlanRules: [this.daily(35), this.weekly(90)],
    });
    this.tagSelection(defaultQuarter, 'default-quarter');

    const defaultDaily35Weekly90Monthly365 = new BackupPlan(
      this,
      'DefaultYear',
      {
        backupVault,
        backupPlanRules: [this.daily(35), this.weekly(90), this.monthly(365)],
      },
    );
    this.tagSelection(defaultDaily35Weekly90Monthly365, 'default-year');

    const defaultDaily35Weekly90Monthly2555 = new BackupPlan(
      this,
      'Default7Years',
      {
        backupVault,
        backupPlanRules: [this.daily(35), this.weekly(90), this.monthly(2555)],
      },
    );
    this.tagSelection(defaultDaily35Weekly90Monthly2555, 'default-7-years');
  }
}
