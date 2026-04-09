import {
  DynamoDBClient,
  type DynamoDBClientConfig,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from "@aws-sdk/lib-dynamodb";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const AWS_REGION = "eu-west-3";

let _docClient: DynamoDBDocumentClient | null = null;

function baseCredentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set");
  }
  return { accessKeyId, secretAccessKey };
}

async function assumeRole(): Promise<DynamoDBDocumentClient> {
  const creds = baseCredentials();
  const baseConfig = { region: AWS_REGION, credentials: creds };

  const ssm = new SSMClient(baseConfig);

  const [roleArnResp, externalIdResp] = await Promise.all([
    ssm.send(
      new GetParameterCommand({ Name: "/mcp/dynamodb-readonly-role-arn/justProd" })
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
    throw new Error("Could not retrieve role ARN or external ID from SSM");
  }

  const sts = new STSClient(baseConfig);
  const assumed = await sts.send(
    new AssumeRoleCommand({
      RoleArn: roleArn,
      RoleSessionName: `ralph-monitor-${Date.now()}`,
      ExternalId: externalId,
      DurationSeconds: 3600,
    })
  );

  const assumedCreds = assumed.Credentials;
  if (!assumedCreds?.AccessKeyId || !assumedCreds.SecretAccessKey || !assumedCreds.SessionToken) {
    throw new Error("STS AssumeRole did not return valid credentials");
  }

  const dynamoConfig: DynamoDBClientConfig = {
    region: AWS_REGION,
    credentials: {
      accessKeyId: assumedCreds.AccessKeyId,
      secretAccessKey: assumedCreds.SecretAccessKey,
      sessionToken: assumedCreds.SessionToken,
    },
  };

  return DynamoDBDocumentClient.from(new DynamoDBClient(dynamoConfig));
}

export async function getDynamoClient(): Promise<DynamoDBDocumentClient> {
  if (_docClient) return _docClient;
  try {
    _docClient = await assumeRole();
  } catch (err) {
    _docClient = null;
    throw err;
  }
  return _docClient;
}

export function resetDynamoClient(): void {
  _docClient = null;
}

export async function scanTable(
  tableName: string,
  filterExpression?: string,
  expressionValues?: Record<string, unknown>
): Promise<Record<string, unknown>[]> {
  const client = await getDynamoClient();
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const cmd = new ScanCommand({
      TableName: tableName,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ...(expressionValues && { ExpressionAttributeValues: expressionValues }),
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    });
    const res = await client.send(cmd);
    if (res.Items) items.push(...(res.Items as Record<string, unknown>[]));
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return items;
}

export async function getItem(
  tableName: string,
  key: Record<string, string>
): Promise<Record<string, unknown> | null> {
  const client = await getDynamoClient();
  const res = await client.send(new GetCommand({ TableName: tableName, Key: key }));
  return (res.Item as Record<string, unknown>) ?? null;
}

export async function resolveShopNames(
  shopIds: string[]
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const client = await getDynamoClient();

  await Promise.all(
    shopIds.map(async (sid) => {
      try {
        const res = await client.send(
          new GetCommand({
            TableName: "ShopsProd",
            Key: { id: sid },
            ProjectionExpression: "id, #n, company_name, shopify",
            ExpressionAttributeNames: { "#n": "name" },
          })
        );
        const item = res.Item as Record<string, unknown> | undefined;
        if (!item) return;
        const display =
          (item.name as string) ||
          (item.company_name as string) ||
          ((item.shopify as Record<string, unknown>)?.app as Record<string, unknown>)
            ?.shop_name as string ||
          ((item.shopify as Record<string, unknown>)?.shop_name as string);
        if (display) names[sid] = display;
      } catch {
        // best-effort
      }
    })
  );

  return names;
}
