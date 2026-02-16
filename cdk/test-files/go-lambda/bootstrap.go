package main

import (
	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
)

func NewBodyResponse(code int, contentType string, body string) events.APIGatewayProxyResponse {
	headers := map[string]string{
		"Content-Type": contentType,
	}
	return events.APIGatewayProxyResponse{
		StatusCode:      code,
		Headers:         headers,
		Body:            body,
		IsBase64Encoded: false,
	}
}

func handler(request events.APIGatewayProxyRequest) (events.APIGatewayProxyResponse, error) {
	return NewBodyResponse(200, "application/json", "Successful test"), nil
}

func main() {
	lambda.Start(handler)
}
