// Type definitions for autoalarm

export interface EC2AlarmManagerObject {
  instanceID: string;
  tags: Tag;
  state: string;
  ec2Metadata?: {platform: string | null; privateIP: string | null};
}

export interface Tag {
  [key: string]: string;
}

export type EC2AlarmManagerArray = EC2AlarmManagerObject[];

export interface Dimension {
  Name: string;
  Value: string;
}

export interface PathMetrics {
  [path: string]: Dimension[];
}

export type LoadBalancerIdentifiers = {
  LBType: 'app' | 'net' | null;
  LBName: string | null;
};

export interface AnomalyAlarmProps {
  evaluationPeriods: number;
  period: number;
  extendedStatistic: string;
}
