import * as workspaces from 'aws-cdk-lib/aws-workspaces';
import type {Construct} from 'constructs';
import {
  ExtendedConstruct,
  type ExtendedConstructProps,
  StandardTags,
} from '../../aws-cdk';
import {LibStandardTags} from '../../truemark';

// Minimum volume sizes for known Amazon-provided bundle IDs. Enforced at synthesis time.
// Keys are AWS WorkSpaces bundle IDs (us-west-2); values are per-bundle minimums in GiB.
// Source: aws workspaces describe-workspace-bundles --owner AMAZON --region us-west-2
const BUNDLE_CONSTRAINTS: Record<
  string,
  {minRootGib: number; minUserGib: number}
> = {
  // ── Value (root 80, user 10) ─────────────────────────────────────────────
  'wsb-hflmxmbbz': {minRootGib: 80, minUserGib: 10}, // Value — RHEL 8
  'wsb-2144yld8f': {minRootGib: 80, minUserGib: 10}, // Value — Rocky 8
  'wsb-xnp4cfzht': {minRootGib: 80, minUserGib: 10}, // Value — Ubuntu 22.04
  'wsb-bh8rsxt14': {minRootGib: 80, minUserGib: 10}, // Value — Windows 10 (Server 2016 based)
  'wsb-4qyzfv08r': {minRootGib: 80, minUserGib: 10}, // Value — Windows 10 (Server 2016 based)
  'wsb-fb2xfp6r8': {minRootGib: 80, minUserGib: 10}, // Value — Windows 10 (Server 2019 based)
  'wsb-dv5v4v37h': {minRootGib: 80, minUserGib: 10}, // Value — Windows 10 (Server 2019 based)
  'wsb-hwwp9rslw': {minRootGib: 80, minUserGib: 10}, // Value — Windows Server 2019 (BYOP)

  // ── Standard (root 80, user 50) ──────────────────────────────────────────
  'wsb-8wthbqzhx': {minRootGib: 80, minUserGib: 50}, // Standard — RHEL 8
  'wsb-gwvwx7hw7': {minRootGib: 80, minUserGib: 50}, // Standard — RHEL 9
  'wsb-djp2k6jxl': {minRootGib: 80, minUserGib: 50}, // Standard — Rocky 8
  'wsb-jv52cj5j0': {minRootGib: 80, minUserGib: 50}, // Standard — Rocky 9
  'wsb-g5rbnq51n': {minRootGib: 80, minUserGib: 50}, // Standard — Ubuntu 22.04
  'wsb-jttwgmx20': {minRootGib: 80, minUserGib: 50}, // Standard — Ubuntu 24.04
  'wsb-82dpmqfgh': {minRootGib: 80, minUserGib: 50}, // Standard — Windows (Server 2025 based)
  'wsb-362t3gdrt': {minRootGib: 80, minUserGib: 50}, // Standard — Windows 10 (Server 2016 based)
  'wsb-8vbljg4r6': {minRootGib: 80, minUserGib: 50}, // Standard — Windows 10 (Server 2016 based)
  'wsb-gk1wpk43z': {minRootGib: 80, minUserGib: 50}, // Standard — Windows 10 (Server 2019 based)
  'wsb-6cbvhvv9f': {minRootGib: 80, minUserGib: 50}, // Standard — Windows 10 (Server 2019 based)
  'wsb-5rldsz4nl': {minRootGib: 80, minUserGib: 50}, // Standard — Windows 10 (Server 2022 based, PCoIP)
  'wsb-93xk71ss4': {minRootGib: 80, minUserGib: 50}, // Standard — Windows 10 (Server 2022 based, WSP)
  'wsb-gttgrcdj2': {minRootGib: 80, minUserGib: 50}, // Standard — Windows Server 2019 (BYOP)
  'wsb-0gcp2n22x': {minRootGib: 80, minUserGib: 50}, // Standard — Windows Server 2022 (BYOP)
  'wsb-xc4r8gyxq': {minRootGib: 80, minUserGib: 50}, // Standard — Windows Server 2025

  // ── Performance (root 80, user 100) ──────────────────────────────────────
  'wsb-5s0yn651c': {minRootGib: 80, minUserGib: 100}, // Performance — RHEL 8
  'wsb-jw7dsffyc': {minRootGib: 80, minUserGib: 100}, // Performance — RHEL 9
  'wsb-b1rv0gp2f': {minRootGib: 80, minUserGib: 100}, // Performance — Rocky 8
  'wsb-dc06lb363': {minRootGib: 80, minUserGib: 100}, // Performance — Rocky 9
  'wsb-208l8k46h': {minRootGib: 80, minUserGib: 100}, // Performance — Ubuntu 22.04
  'wsb-0x6hlpx1g': {minRootGib: 80, minUserGib: 100}, // Performance — Ubuntu 24.04
  'wsb-vz2zm0x4t': {minRootGib: 80, minUserGib: 100}, // Performance — Windows (Server 2025 based)
  'wsb-gm4d5tx2v': {minRootGib: 80, minUserGib: 100}, // Performance — Windows 10 (Server 2016 based)
  'wsb-b9jc2fhhl': {minRootGib: 80, minUserGib: 100}, // Performance — Windows 10 (Server 2016 based)
  'wsb-fn373c5rw': {minRootGib: 80, minUserGib: 100}, // Performance — Windows 10 (Server 2019 based)
  'wsb-55rrhyyg1': {minRootGib: 80, minUserGib: 100}, // Performance — Windows 10 (Server 2019 based)
  'wsb-39nl99v7l': {minRootGib: 80, minUserGib: 100}, // Performance — Windows 10 (Server 2022 based, PCoIP)
  'wsb-gqbt42cw7': {minRootGib: 80, minUserGib: 100}, // Performance — Windows 10 (Server 2022 based, WSP)
  'wsb-1zs7fqzhz': {minRootGib: 80, minUserGib: 100}, // Performance — Windows Server 2019 (BYOP)
  'wsb-vq3qjdb4r': {minRootGib: 80, minUserGib: 100}, // Performance — Windows Server 2022 (BYOP)
  'wsb-2jhz9mqw3': {minRootGib: 80, minUserGib: 100}, // Performance — Windows Server 2025

  // ── Power (root 175, user 100) ────────────────────────────────────────────
  'wsb-w8yg9jx6t': {minRootGib: 175, minUserGib: 100}, // Power — RHEL 8
  'wsb-3zkr3whks': {minRootGib: 175, minUserGib: 100}, // Power — RHEL 9
  'wsb-jdk1hz784': {minRootGib: 175, minUserGib: 100}, // Power — Rocky 8
  'wsb-wztpvcf84': {minRootGib: 175, minUserGib: 100}, // Power — Rocky 9
  'wsb-397hxf1ww': {minRootGib: 175, minUserGib: 100}, // Power — Ubuntu 22.04
  'wsb-2655vqz3h': {minRootGib: 175, minUserGib: 100}, // Power — Ubuntu 24.04
  'wsb-379lp03xq': {minRootGib: 175, minUserGib: 100}, // Power — Windows (Server 2025 based)
  'wsb-drh4m5c2r': {minRootGib: 175, minUserGib: 100}, // Power — Windows 10 (Server 2016 based)
  'wsb-w42vs8svd': {minRootGib: 175, minUserGib: 100}, // Power — Windows 10 (Server 2016 based)
  'wsb-v6727whq5': {minRootGib: 175, minUserGib: 100}, // Power — Windows 10 (Server 2019 based)
  'wsb-g72p36ch9': {minRootGib: 175, minUserGib: 100}, // Power — Windows 10 (Server 2019 based)
  'wsb-6gkrxc3bt': {minRootGib: 175, minUserGib: 100}, // Power — Windows 10 (Server 2022 based, PCoIP)
  'wsb-1bpbv1wvn': {minRootGib: 175, minUserGib: 100}, // Power — Windows 10 (Server 2022 based, WSP)
  'wsb-5qyrwbmvr': {minRootGib: 175, minUserGib: 100}, // Power — Windows Server 2019 (BYOP)
  'wsb-3dv91jbcg': {minRootGib: 175, minUserGib: 100}, // Power — Windows Server 2022 (BYOP)
  'wsb-ct90qd4gc': {minRootGib: 175, minUserGib: 100}, // Power — Windows Server 2025

  // ── PowerPro (root 175, user 100) ─────────────────────────────────────────
  'wsb-93t018t5q': {minRootGib: 175, minUserGib: 100}, // PowerPro — RHEL 8
  'wsb-w9bsk4qn6': {minRootGib: 175, minUserGib: 100}, // PowerPro — RHEL 9
  'wsb-3v313gvgc': {minRootGib: 175, minUserGib: 100}, // PowerPro — Rocky 8
  'wsb-0fbcfzzxj': {minRootGib: 175, minUserGib: 100}, // PowerPro — Rocky 9
  'wsb-8w32qplfk': {minRootGib: 175, minUserGib: 100}, // PowerPro — Ubuntu 22.04
  'wsb-4y2szgyjn': {minRootGib: 175, minUserGib: 100}, // PowerPro — Ubuntu 24.04
  'wsb-g3tfzb764': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows (Server 2025 based)
  'wsb-f5g1109b5': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows 10 (Server 2016 based)
  'wsb-g0xb96cdv': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows 10 (Server 2016 based)
  'wsb-bf5th9f2y': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows 10 (Server 2019 based)
  'wsb-fx3bdyds8': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows 10 (Server 2019 based)
  'wsb-h5bkw8r9g': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows 10 (Server 2022 based, PCoIP)
  'wsb-b1gz69yyy': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows 10 (Server 2022 based, WSP)
  'wsb-jcd494yhj': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows Server 2019 (BYOP)
  'wsb-0qcgctgrv': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows Server 2022 (BYOP)
  'wsb-x34h3nyhx': {minRootGib: 175, minUserGib: 100}, // PowerPro — Windows Server 2025

  // ── GeneralPurpose (root 175, user 100) ───────────────────────────────────
  'wsb-dh0nvlcl4': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.4xlarge — Windows (Server 2025 based)
  'wsb-09fdsggz9': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.4xlarge — Windows 10 (Server 2022 based)
  'wsb-hm0vlpb03': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.4xlarge — Windows 10 (Server 2022 based)
  'wsb-jmw30bx99': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.4xlarge — Windows 10 (Server 2022 based, BYOP)
  'wsb-56fmtckz3': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.4xlarge — Windows Server 2025
  'wsb-0kbt5v92k': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.8xlarge — Windows (Server 2025 based)
  'wsb-c75338755': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.8xlarge — Windows 10 (Server 2022 based)
  'wsb-6x9zq3bdm': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.8xlarge — Windows 10 (Server 2022 based)
  'wsb-5wvz5r60f': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.8xlarge — Windows 10 (Server 2022 based, BYOP)
  'wsb-vbb86nv06': {minRootGib: 175, minUserGib: 100}, // GeneralPurpose.8xlarge — Windows Server 2025

  // ── Graphics / GraphicsPro G4dn (root 100, user 100) ─────────────────────
  'wsb-jvqm8w0vx': {minRootGib: 100, minUserGib: 100}, // Graphics.G4dn — Windows (Server 2025 based)
  'wsb-fg6yf2z1c': {minRootGib: 100, minUserGib: 100}, // Graphics.G4dn — Windows Server 2025
  'wsb-dxtj45vgn': {minRootGib: 100, minUserGib: 100}, // Graphics.g4dn — Ubuntu 22.04
  'wsb-96qtqtx65': {minRootGib: 100, minUserGib: 100}, // Graphics.g4dn — Windows 10 (Server 2019 based)
  'wsb-g6cfwkdpz': {minRootGib: 100, minUserGib: 100}, // Graphics.g4dn — Windows 10 (Server 2022 based, PCoIP)
  'wsb-xyv83v8b5': {minRootGib: 100, minUserGib: 100}, // Graphics.g4dn — Windows 10 (Server 2022 based, WSP)
  'wsb-kflpvfq6f': {minRootGib: 100, minUserGib: 100}, // Graphics.g4dn — Windows Server 2019 (BYOP)
  'wsb-6081l95sg': {minRootGib: 100, minUserGib: 100}, // Graphics.g4dn — Windows Server 2022 (BYOP)
  'wsb-5p7wdkt3q': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.G4dn — Windows (Server 2025 based)
  'wsb-7ydfx2ff9': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.G4dn — Windows Server 2025
  'wsb-c9zmpvd8q': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.g4dn — Ubuntu 22.04
  'wsb-jgx0cjr8w': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.g4dn — Windows 10 (Server 2019 based)
  'wsb-84jf7dff4': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.g4dn — Windows 10 (Server 2022 based, PCoIP)
  'wsb-7pjns70jq': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.g4dn — Windows 10 (Server 2022 based, WSP)
  'wsb-v5znyph46': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.g4dn — Windows Server 2019 (BYOP)
  'wsb-bp30j1yhr': {minRootGib: 100, minUserGib: 100}, // GraphicsPro.g4dn — Windows Server 2022 (BYOP)

  // ── Graphics g6.xlarge / g6f.large / g6f.xlarge (root 100, user 100) ─────
  'wsb-366jxj69y': {minRootGib: 100, minUserGib: 100}, // Graphics.g6.xlarge — Windows Server 2022 (BYOP)
  'wsb-9k115ynj8': {minRootGib: 100, minUserGib: 100}, // Graphics.g6.xlarge — Windows Server 2022 (WSP)
  'wsb-b47fvc2qc': {minRootGib: 100, minUserGib: 100}, // Graphics.g6.xlarge — Windows Server 2025 (BYOP)
  'wsb-wyrhw4ckb': {minRootGib: 100, minUserGib: 100}, // Graphics.g6.xlarge — Windows Server 2025 (WSP)
  'wsb-dm57z1sbx': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.large — Windows Server 2022 (BYOP)
  'wsb-5y4c790py': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.large — Windows Server 2022 (WSP)
  'wsb-g930xmmrx': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.large — Windows Server 2025 (BYOP)
  'wsb-9q8j0h5xy': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.large — Windows Server 2025 (WSP)
  'wsb-xr0y7chcy': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.xlarge — Windows Server 2022 (BYOP)
  'wsb-5zbz21dp9': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.xlarge — Windows Server 2022 (WSP)
  'wsb-dfsl49fc2': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.xlarge — Windows Server 2025 (BYOP)
  'wsb-k4zkh7wl2': {minRootGib: 100, minUserGib: 100}, // Graphics.g6f.xlarge — Windows Server 2025 (WSP)

  // ── Graphics g6.2xlarge / g6f.2xlarge (root 150, user 100) ───────────────
  'wsb-jtn2mf1lh': {minRootGib: 150, minUserGib: 100}, // Graphics.g6.2xlarge — Windows Server 2022 (BYOP)
  'wsb-k978cqs7w': {minRootGib: 150, minUserGib: 100}, // Graphics.g6.2xlarge — Windows Server 2022 (WSP)
  'wsb-78vqbrb2x': {minRootGib: 150, minUserGib: 100}, // Graphics.g6.2xlarge — Windows Server 2025 (BYOP)
  'wsb-23fv3gm1c': {minRootGib: 150, minUserGib: 100}, // Graphics.g6.2xlarge — Windows Server 2025 (WSP)
  'wsb-1s7n8y91r': {minRootGib: 150, minUserGib: 100}, // Graphics.g6f.2xlarge — Windows Server 2022 (BYOP)
  'wsb-hx1rshk4r': {minRootGib: 150, minUserGib: 100}, // Graphics.g6f.2xlarge — Windows Server 2022 (WSP)
  'wsb-c6typwx45': {minRootGib: 150, minUserGib: 100}, // Graphics.g6f.2xlarge — Windows Server 2025 (BYOP)
  'wsb-g2qdnz9s2': {minRootGib: 150, minUserGib: 100}, // Graphics.g6f.2xlarge — Windows Server 2025 (WSP)

  // ── Graphics g6.4xlarge / g6f.4xlarge (root 200, user 150) ───────────────
  'wsb-8h9mlm8vf': {minRootGib: 200, minUserGib: 150}, // Graphics.g6.4xlarge — Windows Server 2022 (BYOP)
  'wsb-9zg6r5j55': {minRootGib: 200, minUserGib: 150}, // Graphics.g6.4xlarge — Windows Server 2022 (WSP)
  'wsb-fz398g82q': {minRootGib: 200, minUserGib: 150}, // Graphics.g6.4xlarge — Windows Server 2025 (BYOP)
  'wsb-4f5fsw3x2': {minRootGib: 200, minUserGib: 150}, // Graphics.g6.4xlarge — Windows Server 2025 (WSP)
  'wsb-vp7y05j1k': {minRootGib: 200, minUserGib: 150}, // Graphics.g6f.4xlarge — Windows Server 2022 (BYOP)
  'wsb-0fgmwf9zb': {minRootGib: 200, minUserGib: 150}, // Graphics.g6f.4xlarge — Windows Server 2022 (WSP)
  'wsb-hbpv2p75b': {minRootGib: 200, minUserGib: 150}, // Graphics.g6f.4xlarge — Windows Server 2025 (BYOP)
  'wsb-5kc7mpz0h': {minRootGib: 200, minUserGib: 150}, // Graphics.g6f.4xlarge — Windows Server 2025 (WSP)

  // ── Graphics g6.8xlarge / gr6.4xlarge / gr6f.4xlarge (root 250, user 200) ─
  'wsb-0pgdylyy3': {minRootGib: 250, minUserGib: 200}, // Graphics.g6.8xlarge — Windows Server 2022 (BYOP)
  'wsb-cd6bk703l': {minRootGib: 250, minUserGib: 200}, // Graphics.g6.8xlarge — Windows Server 2022 (WSP)
  'wsb-3cw6dbj99': {minRootGib: 250, minUserGib: 200}, // Graphics.g6.8xlarge — Windows Server 2025 (BYOP)
  'wsb-4ld2n6ghx': {minRootGib: 250, minUserGib: 200}, // Graphics.g6.8xlarge — Windows Server 2025 (WSP)
  'wsb-f2hnb6qtk': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6.4xlarge — Windows Server 2022 (BYOP)
  'wsb-5mpqp50vv': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6.4xlarge — Windows Server 2022 (WSP)
  'wsb-9sm72r6sh': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6.4xlarge — Windows Server 2025 (BYOP)
  'wsb-cfjzmh1dw': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6.4xlarge — Windows Server 2025 (WSP)
  'wsb-k7d8jhfzq': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6f.4xlarge — Windows Server 2022 (BYOP)
  'wsb-g1gsvq9cj': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6f.4xlarge — Windows Server 2022 (WSP)
  'wsb-25st5qnb5': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6f.4xlarge — Windows Server 2025 (BYOP)
  'wsb-vrlc2fkbd': {minRootGib: 250, minUserGib: 200}, // Graphics.gr6f.4xlarge — Windows Server 2025 (WSP)

  // ── Graphics g6.16xlarge / gr6.8xlarge (root 300, user 200) ──────────────
  'wsb-7238h3t32': {minRootGib: 300, minUserGib: 200}, // Graphics.g6.16xlarge — Windows Server 2022 (BYOP)
  'wsb-8b24qtqvz': {minRootGib: 300, minUserGib: 200}, // Graphics.g6.16xlarge — Windows Server 2022 (WSP)
  'wsb-f0448rpjr': {minRootGib: 300, minUserGib: 200}, // Graphics.g6.16xlarge — Windows Server 2025 (BYOP)
  'wsb-xky6ck4d8': {minRootGib: 300, minUserGib: 200}, // Graphics.g6.16xlarge — Windows Server 2025 (WSP)
  'wsb-hkffzrlwk': {minRootGib: 300, minUserGib: 200}, // Graphics.gr6.8xlarge — Windows Server 2022 (BYOP)
  'wsb-7vyww6ccb': {minRootGib: 300, minUserGib: 200}, // Graphics.gr6.8xlarge — Windows Server 2022 (WSP)
  'wsb-0hzvgpb94': {minRootGib: 300, minUserGib: 200}, // Graphics.gr6.8xlarge — Windows Server 2025 (BYOP)
  'wsb-4nqlpghrb': {minRootGib: 300, minUserGib: 200}, // Graphics.gr6.8xlarge — Windows Server 2025 (WSP)
};

/**
 * Properties for AwsWorkspacesUser.
 */
export interface AwsWorkspacesUserProps extends ExtendedConstructProps {
  /**
   * Directory ID from the AwsWorkspaces foundation construct.
   */
  readonly directoryId: string;

  /**
   * KMS key ARN from the AwsWorkspaces foundation construct for volume encryption.
   */
  readonly kmsKeyArn: string;

  /**
   * Patch group name from the AwsWorkspaces foundation construct.
   * The WorkSpace is tagged with this value so SSM Patch Manager applies the
   * HIPAA patch baseline.
   */
  readonly patchGroupName: string;

  /**
   * Username for the WorkSpace. Must already exist in the directory.
   */
  readonly userName: string;

  /**
   * WorkSpaces bundle ID (e.g., 'wsb-dc06lb363' for Rocky Linux 9 Performance).
   */
  readonly bundleId: string;

  /**
   * WorkSpaces running mode.
   *
   * @default 'AUTO_STOP'
   */
  readonly runningMode?: 'AUTO_STOP' | 'ALWAYS_ON';

  /**
   * WorkSpaces compute type.
   *
   * @default 'PERFORMANCE'
   */
  readonly computeType?:
    | 'VALUE'
    | 'STANDARD'
    | 'PERFORMANCE'
    | 'POWER'
    | 'GRAPHICS'
    | 'GRAPHICSPRO';

  /**
   * Root volume size in GiB. Must meet the bundle minimum.
   *
   * @default 80
   */
  readonly rootVolumeSizeGib?: number;

  /**
   * User volume size in GiB. Must meet the bundle minimum.
   *
   * @default 100
   */
  readonly userVolumeSizeGib?: number;

  /**
   * Enable KMS encryption on the WorkSpace root and user volumes.
   * Set to false only for a dedicated golden-image build WorkSpace — AWS WorkSpaces
   * cannot capture a custom bundle from a WorkSpace with encrypted volumes.
   *
   * @default true
   */
  readonly volumeEncryptionEnabled?: boolean;
}

/**
 * A single AWS WorkSpace for one user.
 *
 * Deploy one AwsWorkspacesUser (or a stack containing one) per user. Destroying it
 * removes only that user's WorkSpace without affecting the shared AwsWorkspaces
 * foundation (VPC, KMS, Directory, S3, SSM infrastructure).
 *
 * The WorkSpace is tagged with ManagedBy=CDK so SSM Associations defined in the
 * AwsWorkspaces infrastructure layer automatically apply to it, and with
 * Patch Group=<patchGroupName> so the HIPAA patch baseline applies.
 */
export class AwsWorkspacesUser extends ExtendedConstruct {
  static readonly DEFAULT_COMPUTE_TYPE = 'PERFORMANCE';
  static readonly DEFAULT_ROOT_VOLUME_GIB = 80;
  static readonly DEFAULT_USER_VOLUME_GIB = 100;

  readonly workspace: workspaces.CfnWorkspace;

  constructor(scope: Construct, id: string, props: AwsWorkspacesUserProps) {
    super(scope, id, {
      standardTags: StandardTags.merge(props.standardTags, LibStandardTags),
    });

    const constraints = BUNDLE_CONSTRAINTS[props.bundleId];
    if (constraints) {
      const rootGib =
        props.rootVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_ROOT_VOLUME_GIB;
      const userGib =
        props.userVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_USER_VOLUME_GIB;
      if (rootGib < constraints.minRootGib) {
        throw new Error(
          `rootVolumeSizeGib (${rootGib}) is below the minimum for bundle ${props.bundleId} (${constraints.minRootGib} GiB)`,
        );
      }
      if (userGib < constraints.minUserGib) {
        throw new Error(
          `userVolumeSizeGib (${userGib}) is below the minimum for bundle ${props.bundleId} (${constraints.minUserGib} GiB)`,
        );
      }
    }

    const runningMode = props.runningMode ?? 'AUTO_STOP';
    const computeType =
      props.computeType ?? AwsWorkspacesUser.DEFAULT_COMPUTE_TYPE;
    const volumeEncryptionEnabled = props.volumeEncryptionEnabled ?? true;

    this.workspace = new workspaces.CfnWorkspace(this, 'Workspace', {
      directoryId: props.directoryId,
      bundleId: props.bundleId,
      userName: props.userName,
      rootVolumeEncryptionEnabled: volumeEncryptionEnabled,
      userVolumeEncryptionEnabled: volumeEncryptionEnabled,
      volumeEncryptionKey: volumeEncryptionEnabled
        ? props.kmsKeyArn
        : undefined,
      workspaceProperties: {
        runningMode,
        runningModeAutoStopTimeoutInMinutes:
          runningMode === 'AUTO_STOP' ? 60 : undefined,
        rootVolumeSizeGib:
          props.rootVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_ROOT_VOLUME_GIB,
        userVolumeSizeGib:
          props.userVolumeSizeGib ?? AwsWorkspacesUser.DEFAULT_USER_VOLUME_GIB,
        computeTypeName: computeType,
      },
      tags: [
        {key: 'ManagedBy', value: 'CDK'},
        {key: 'Compliance', value: 'HIPAA'},
        {key: 'Patch Group', value: props.patchGroupName},
      ],
    });
  }
}
