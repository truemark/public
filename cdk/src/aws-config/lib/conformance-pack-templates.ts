/**
 * Mapping of conformance pack names to their AWS repository URLs.
 * These templates are maintained by AWS Labs and provide operational best practices
 * for various compliance frameworks and security standards.
 */
export const CONFORMANCE_PACK_TEMPLATES: Record<string, string> = {
  'nist-800-171': 'Operational-Best-Practices-for-NIST-800-171.yaml',
  'hipaa': 'Operational-Best-Practices-for-HIPAA-Security.yaml',
  'pci-dss': 'Operational-Best-Practices-for-PCI-DSS.yaml',
  'pci-dss-4-0-include-global':
    'Operational-Best-Practices-for-PCI-DSS-v4.0-including-global-resourcetypes.yml',
  'pci-dss-4-0-without-global':
    'Operational-Best-Practices-for-PCI-DSS-v4.0-excluding-global-resourcetypes.yml',
  'sox': 'Operational-Best-Practices-for-SOX.yaml',
  'fedramp-low': 'Operational-Best-Practices-for-FedRAMP-Low.yaml',
  'fedramp-moderate': 'Operational-Best-Practices-for-FedRAMP-Moderate.yaml',
  'fedramp-high': 'Operational-Best-Practices-for-FedRAMP-HighPart1.yaml',
  'cis': 'Operational-Best-Practices-for-CIS.yaml',
  'cis-aws-v1.4-level1':
    'Operational-Best-Practices-for-CIS-AWS-v1.4-Level1.yaml',
  'cis-aws-v1.4-level2':
    'Operational-Best-Practices-for-CIS-AWS-v1.4-Level2.yaml',
  'nist-csf': 'Operational-Best-Practices-for-NIST-CSF.yaml',
  'nist-800-53-rev4': 'Operational-Best-Practices-for-NIST-800-53-rev-4.yaml',
  'nist-800-53-rev5': 'Operational-Best-Practices-for-NIST-800-53-rev-5.yaml',
  'cmmc-level-1': 'Operational-Best-Practices-for-CMMC-Level-1.yaml',
  'cmmc-level-2': 'Operational-Best-Practices-for-CMMC-Level-2.yaml',
  'cmmc-level-3': 'Operational-Best-Practices-for-CMMC-Level-3.yaml',
  'cmmc-level-4': 'Operational-Best-Practices-for-CMMC-Level-4.yaml',
  'cmmc-level-5': 'Operational-Best-Practices-for-CMMC-Level-5.yaml',
  'aws-well-architected':
    'Operational-Best-Practices-for-AWS-Well-Architected-Security-Pillar.yaml',
  'cjis': 'Operational-Best-Practices-for-CJIS.yaml',
  'ffiec': 'Operational-Best-Practices-for-FFIEC.yaml',
  'gramm-leach-bliley':
    'Operational-Best-Practices-for-Gramm-Leach-Bliley-Act.yaml',
  'nydfs': 'Operational-Best-Practices-for-NYDFS-23-NYCRR-500.yaml',
  'apra-cpg-234': 'Operational-Best-Practices-for-APRA-CPG-234.yaml',
  'mas-trmg': 'Operational-Best-Practices-for-MAS-TRMG.yaml',
  'rbi-basic-cyber':
    'Operational-Best-Practices-for-RBI-Basic-Cyber-Security-Framework.yaml',
  'swift-csp': 'Operational-Best-Practices-for-SWIFT-CSP.yaml',
  'k-isms': 'Operational-Best-Practices-for-KISMS.yaml',
  'enisa-cybersecurity':
    'Operational-Best-Practices-for-ENISA-Cybersecurity-Guide.yaml',
  'ncsc-caf': 'Operational-Best-Practices-for-NCSC-CAF.yaml',
  'acsc-essential8': 'Operational-Best-Practices-for-ACSC-Essential8.yaml',
  'acsc-ism': 'Operational-Best-Practices-for-ACSC-ISM.yaml',
  'cccs-medium': 'Operational-Best-Practices-for-CCCS-Medium.yaml',
  'nzism': 'Operational-Best-Practices-for-NZISM.yaml',
  'germany-c5': 'Operational-Best-Practices-for-Germany-C5.yaml',
  'ccn-ens-low': 'Operational-Best-Practices-for-CCN-ENS-Low.yaml',
  'ccn-ens-medium': 'Operational-Best-Practices-for-CCN-ENS-Medium.yaml',
  'ccn-ens-high': 'Operational-Best-Practices-for-CCN-ENS-High.yaml',
  'bnm-rmit': 'Operational-Best-Practices-for-BNM-RMiT.yaml',
  'nbc-trmg': 'Operational-Best-Practices-for-NBC-TRMG.yaml',
  'mas-notice-655': 'Operational-Best-Practices-for-MAS-Notice-655.yaml',
  'rbi-master-direction':
    'Operational-Best-Practices-for-RBI-MasterDirection.yaml',
  'abs-ccig-material':
    'Operational-Best-Practices-for-ABS-CCIGv2-Material.yaml',
  'abs-ccig-standard':
    'Operational-Best-Practices-for-ABS-CCIGv2-Standard.yaml',
  'nist-1800-25': 'Operational-Best-Practices-for-NIST-1800-25.yaml',
  'nist-privacy': 'Operational-Best-Practices-for-NIST-Privacy-Framework.yaml',
  'irs-1075': 'Operational-Best-Practices-for-IRS-1075.yaml',
  'fda-21cfr-part11': 'Operational-Best-Practices-for-FDA-21CFR-Part-11.yaml',
  'gxp-eu-annex11': 'Operational-Best-Practices-for-GxP-EU-Annex-11.yaml',
  'nerc-cip': 'Operational-Best-Practices-for-NERC-CIP-BCSI.yaml',
  'cisa-cyber-essentials':
    'Operational-Best-Practices-for-CISA-Cyber-Essentials.yaml',
  'cis-critical-security-controls-v8-ig1':
    'Operational-Best-Practices-for-CIS-Critical-Security-Controls-v8-IG1.yaml',
  'cis-critical-security-controls-v8-ig2':
    'Operational-Best-Practices-for-CIS-Critical-Security-Controls-v8-IG2.yaml',
  'cis-critical-security-controls-v8-ig3':
    'Operational-Best-Practices-for-CIS-Critical-Security-Controls-v8-IG3.yaml',
  'cis-top20': 'Operational-Best-Practices-for-CIS-Top20.yaml',
  'aws-control-tower': 'AWS-Control-Tower-Detective-Guardrails.yaml',
  'nist-800-181': 'Operational-Best-Practices-For-NIST-800-181.yaml',
  'nist-800-172': 'Operational-Best-Practices-for-NIST-800-172.yaml',
  'cmmc-2.0-level-1': 'Operational-Best-Practices-for-CMMC-2.0-Level-1.yaml',
  'cmmc-2.0-level-2': 'Operational-Best-Practices-for-CMMC-2.0-Level-2.yaml',
};

/**
 * Gets the template URL for a conformance pack.
 *
 * @param packName The name of the conformance pack
 * @param templateVersion The template version (commit hash, tag, or 'latest')
 * @param templateRepositoryUrl The base URL for the conformance pack templates repository
 * @returns The full URL to the conformance pack template
 */
export function getConformancePackTemplateUrl(
  packName: string,
  templateVersion: string = 'latest',
  templateRepositoryUrl: string = 'https://raw.githubusercontent.com/awslabs/aws-config-rules',
): string {
  const templateFile = CONFORMANCE_PACK_TEMPLATES[packName];
  if (!templateFile) {
    throw new Error(
      `Unknown conformance pack: ${packName}. Available packs: ${Object.keys(CONFORMANCE_PACK_TEMPLATES).join(', ')}`,
    );
  }

  const templateRef = templateVersion === 'latest' ? 'master' : templateVersion;
  return `${templateRepositoryUrl}/${templateRef}/aws-config-conformance-packs/${templateFile}`;
}
