// import {Template} from 'aws-cdk-lib/assertions';
// import {HelperTest} from '../../helper.test';
// import {HostedZone} from 'aws-cdk-lib/aws-route53';
// import {SourceType, Website} from './website';

test('Empty Test', () => {
  // Nothing to do
});

// test('Hugo Website Test', () => {
//   const stack = HelperTest.stack();
//   new Website(stack, 'TestWebsite', {
//     sourceType: SourceType.Hugo,
//     sourceDirectory: HelperTest.resolveTestFiles('hugo-website'),
//   });
//   const template = Template.fromStack(stack);
//   template.hasResourceProperties('AWS::CloudFront::Distribution', {});
// });

// test('ARecord Created for Website', () => {
//   const stack = HelperTest.stack();
//   new Website(stack, 'TestWebsite', {
//     sourceType: SourceType.Hugo,
//     sourceDirectory: HelperTest.resolveTestFiles('hugo-website'),
//     certificateArn: 'arn:aws:acm:us-east-1:123456789012:certificate/XXXX',
//     domainNames: [
//       {
//         prefix: 'www',
//         // TODO In the fugure need to figure out how to mock lookups
//         zone: new HostedZone(stack, 'example-com', {zoneName: 'example.com'}),
//       },
//     ],
//   });
//   const template = Template.fromStack(stack);
//   // console.log(template.toJSON());
//   // HelperTest.logResources(template, "AWS::Route53::RecordSet");
//   template.hasResourceProperties('AWS::Route53::RecordSet', {});
// });

// TODO We need to speed this up
// test("Npm Dist Website Test", () => {
//   const stack = HelperTest.stack();
//   new Website(stack, "TestWebsite", {
//     sourceType: SourceType.NpmDist,
//     sourceDirectory: HelperTest.resolveTestFiles("angular-website")
//   });
//   const template = Template.fromStack(stack);
//   template.hasResourceProperties("AWS::CloudFront::Distribution", {});
// });

// TODO Need to fix
// test("Website Certificate Test", () => {
//   const stack = HelperTest.stack();
//   new Website(stack, "TestWebsite", {
//     sourceType: SourceType.Hugo,
//     sourceDirectory: HelperTest.resolveTestFiles("hugo-website"),
//     domainNames: [
//       new DomainName("test", "example.com"),
//       new DomainName("test2", "example.com")
//     ]
//   });
//   const template = Template.fromStack(stack);
//   console.log(template.toJSON());
//   // HelperTest.logResources()
// });
