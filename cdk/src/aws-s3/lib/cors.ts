import {CorsRule, HttpMethods} from 'aws-cdk-lib/aws-s3';

export const OPEN_CORS_RULE: CorsRule = {
  allowedMethods: [
    HttpMethods.GET,
    HttpMethods.HEAD,
    HttpMethods.DELETE,
    HttpMethods.PUT,
    HttpMethods.POST,
  ],
  allowedOrigins: ['*'],
  allowedHeaders: ['*'],
  exposedHeaders: ['ETag'],
  maxAge: 3000,
};
