import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'

export async function getSecretFromAws(secret: string): Promise<string> {
  const client = new SecretsManagerClient({});

  const input = { "SecretId": secret };
  const command = new GetSecretValueCommand(input);
  const response = await client.send(command);

  return response.SecretString!
}
