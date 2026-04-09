import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, string> = {};

  checks.POSTHOG_API_KEY = process.env.POSTHOG_API_KEY
    ? `set (${process.env.POSTHOG_API_KEY.slice(0, 8)}...)`
    : "MISSING";
  checks.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID
    ? `set (${process.env.AWS_ACCESS_KEY_ID.slice(0, 8)}...)`
    : "MISSING";
  checks.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY
    ? `set (length=${process.env.AWS_SECRET_ACCESS_KEY.length})`
    : "MISSING";
  checks.AWS_REGION = process.env.AWS_REGION ?? "MISSING";

  let ssmResult = "not tested";
  let stsResult = "not tested";
  let dynamoResult = "not tested";
  let posthogResult = "not tested";

  try {
    const { SSMClient, GetParameterCommand } = await import(
      "@aws-sdk/client-ssm"
    );
    const ssm = new SSMClient({
      region: "eu-west-3",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    const resp = await ssm.send(
      new GetParameterCommand({
        Name: "/mcp/dynamodb-readonly-role-arn/justProd",
      })
    );
    ssmResult = `OK (roleArn=${resp.Parameter?.Value?.slice(0, 30)}...)`;
  } catch (err) {
    ssmResult = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  try {
    const { SSMClient, GetParameterCommand } = await import(
      "@aws-sdk/client-ssm"
    );
    const { STSClient, AssumeRoleCommand } = await import(
      "@aws-sdk/client-sts"
    );
    const baseCreds = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    };
    const baseConfig = { region: "eu-west-3", credentials: baseCreds };
    const ssm = new SSMClient(baseConfig);

    const [roleArnResp, externalIdResp] = await Promise.all([
      ssm.send(
        new GetParameterCommand({
          Name: "/mcp/dynamodb-readonly-role-arn/justProd",
        })
      ),
      ssm.send(
        new GetParameterCommand({
          Name: "/mcp/dynamodb-readonly-external-id/justProd",
          WithDecryption: true,
        })
      ),
    ]);

    const roleArn = roleArnResp.Parameter?.Value;
    const externalId = externalIdResp.Parameter?.Value;

    if (!roleArn || !externalId) {
      stsResult = "FAILED: Missing role ARN or external ID from SSM";
    } else {
      const sts = new STSClient(baseConfig);
      const assumed = await sts.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          RoleSessionName: `ralph-debug-${Date.now()}`,
          ExternalId: externalId,
          DurationSeconds: 900,
        })
      );
      stsResult = assumed.Credentials?.AccessKeyId
        ? `OK (tempKey=${assumed.Credentials.AccessKeyId.slice(0, 8)}...)`
        : "FAILED: No credentials returned";
    }
  } catch (err) {
    stsResult = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  try {
    const { getDynamoClient } = await import("@/lib/dynamo");
    const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
    const client = await getDynamoClient();
    const res = await client.send(
      new ScanCommand({
        TableName: "AiAgentConversationsProd",
        Limit: 1,
      })
    );
    dynamoResult = `OK (scanned ${res.Items?.length ?? 0} items, count=${res.Count})`;
  } catch (err) {
    dynamoResult = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  try {
    const key = process.env.POSTHOG_API_KEY;
    if (!key) throw new Error("POSTHOG_API_KEY not set");
    const res = await fetch("https://us.posthog.com/api/projects/7531/query/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: {
          kind: "HogQLQuery",
          query: "SELECT 1 as test",
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      posthogResult = `FAILED: HTTP ${res.status} - ${text.slice(0, 200)}`;
    } else {
      const json = await res.json();
      posthogResult = `OK (results=${JSON.stringify(json.results?.slice(0, 1))})`;
    }
  } catch (err) {
    posthogResult = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  return NextResponse.json({
    envVars: checks,
    ssm: ssmResult,
    sts: stsResult,
    dynamo: dynamoResult,
    posthog: posthogResult,
  });
}
