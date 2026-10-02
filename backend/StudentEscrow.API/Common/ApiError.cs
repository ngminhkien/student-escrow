namespace StudentEscrow.API.Common;

public sealed record ApiError(string Code, string Message, string TraceId);
