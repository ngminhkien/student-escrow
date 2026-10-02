using Microsoft.AspNetCore.Diagnostics;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using StudentEscrow.Application.Common;

namespace StudentEscrow.API.Common;

public sealed class ExceptionHandler(ILogger<ExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        var error = exception switch
        {
            ApplicationError application => (application.StatusCode, application.Code, application.Message),
            SqlException or DbUpdateException => (503, "DATABASE_UNAVAILABLE", "Database chưa sẵn sàng. Kiểm tra SQL Server và migration."),
            _ => (500, "INTERNAL_ERROR", "Có lỗi xử lý. Dùng traceId để kiểm tra log.")
        };

        if (error.Item1 >= 500)
        {
            logger.LogError(exception, "Request failed with {ErrorCode}, trace {TraceId}", error.Item2, context.TraceIdentifier);
        }

        context.Response.StatusCode = error.Item1;
        await context.Response.WriteAsJsonAsync(new ApiError(error.Item2, error.Item3, context.TraceIdentifier), cancellationToken);
        return true;
    }
}
