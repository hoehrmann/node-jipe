
export type JsonrpcResult = { [key: string]: any; };

export type JsonrpcParams = { [key: string]: any; } | null;

export type JsonrpcIdentifier = number;

export type JsonrpcResponse = (
  JsonrpcResponseError | JsonrpcResponseResult
);

export type JsonrpcMessage = (
  JsonrpcRequest | JsonrpcResponse | JsonrpcNotification
);

export type JsonrpcMessageType = (
  'failure' | 'result' | 'request' | 'malformed' 
);

export interface JsonrpcError {
  code: number;
  message: string;
  data: any;
}

interface WithVersion {
  jsonrpc: '2.0';
}

export interface JsonrpcNotification extends WithVersion {
  method: string;
  params: JsonrpcParams;
}

export interface JsonrpcRequest extends WithVersion {
  method: string;
  params: JsonrpcParams;
  id: JsonrpcIdentifier;
}

export interface JsonrpcResponseError extends WithVersion {
  error: JsonrpcError;
  id: JsonrpcIdentifier;
}

export interface JsonrpcResponseResult extends WithVersion {
  result: any;
  id: JsonrpcIdentifier;
}

export interface JsonrpcStdErrors {
  PARSE_ERROR:      { code: -32700, message: 'Parse error' };
  INVALID_REQUEST:  { code: -32600, message: 'Invalid request' };
  METHOD_NOT_FOUND: { code: -32601, message: 'Method not found' };
  INVALID_PARAMS:   { code: -32602, message: 'Invalid params' };
  INTERNAL_ERROR:   { code: -32603, message: 'Internal error' };
}
