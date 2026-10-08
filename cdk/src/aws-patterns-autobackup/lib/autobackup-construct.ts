import {Duration} from 'aws-cdk-lib';
import {
  BackupPlan,
  BackupPlanRule,
  BackupResource,
  BackupVault,
  type CfnBackupVault,
} from 'aws-cdk-lib/aws-backup';
import {Schedule} from 'aws-cdk-lib/aws-events';
import type {Construct} from 'constructs';
import {ExtendedConstruct} from '../../aws-cdk';

export interface AutoBackupProps {
  /**
   * If true, applies AWS Backup Vault Lock to the AutoBackup vault.
   * Note: Vault Lock applies to all recovery points in the vault.
   */
  enableImmutable?: boolean;

  /**
   * When provided (min 3), Vault Lock is Compliance mode.
   * When omitted, Vault Lock is Governance mode.
   */
  vaultLockChangeableForDays?: number;
}

export class AutoBackup extends ExtendedConstruct {
  private daily(days: number): BackupPlanRule {
    return new BackupPlanRule({
      ruleName: 'Daily',
      scheduleExpression: Schedule.cron({hour: '5', minute: '0'}),
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
      scheduleExpression: Schedule.cron({day: '1', hour: '5', minute: '0'}),
      moveToColdStorageAfter: Duration.days(30),
      deleteAfter: Duration.days(days),
    });
  }

  private tagSelection(plan: BackupPlan, tagValue: string) {
    plan.addSelection('Selection', {
      resources: [BackupResource.fromTag('backup:policy', tagValue)],
    });
  }

  constructor(scope: Construct, id: string, props: AutoBackupProps = {}) {
    super(scope, id);

    const backupVault = new BackupVault(this, 'Default', {
      backupVaultName: 'AutoBackup',
    });

    // Apply Vault Lock when enableImmutable is true
    if (props.enableImmutable) {
      const cfnVault = backupVault.node.defaultChild as CfnBackupVault;
      cfnVault.lockConfiguration = {
        minRetentionDays: 1,
        maxRetentionDays: 2555,
        ...(props.vaultLockChangeableForDays !== undefined
          ? {changeableForDays: props.vaultLockChangeableForDays}
          : {}),
      };
    }

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
