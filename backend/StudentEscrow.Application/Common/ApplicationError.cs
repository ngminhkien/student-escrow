namespace StudentEscrow.Application.Common;

public sealed class ApplicationError(string code, string message, int statusCode) : Exception(message)
{
    public string Code { get; } = code;
    public int StatusCode { get; } = statusCode;
}
