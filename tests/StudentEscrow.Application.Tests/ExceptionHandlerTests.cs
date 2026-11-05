using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using StudentEscrow.API.Common;
using Xunit;

namespace StudentEscrow.Application.Tests;

public sealed class ExceptionHandlerTests
{
    private sealed class RecordingLogger : ILogger<ExceptionHandler>
    {
        public int Errors { get; private set; }
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel >= LogLevel.Error) Errors++;
        }
    }

    [Fact]
    public async Task A_request_the_browser_cancelled_is_not_logged_as_a_failure()
    {
        using var aborted = new CancellationTokenSource();
        var context = new DefaultHttpContext { RequestAborted = aborted.Token };
        await aborted.CancelAsync();
        var logger = new RecordingLogger();

        var handled = await new ExceptionHandler(logger).TryHandleAsync(context, new InvalidOperationException("Operation cancelled by user."), aborted.Token);

        Assert.True(handled);
        Assert.Equal(0, logger.Errors);
        Assert.Equal(499, context.Response.StatusCode);
    }

    [Fact]
    public async Task A_real_failure_on_a_live_request_is_still_logged()
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();
        var logger = new RecordingLogger();

        var handled = await new ExceptionHandler(logger).TryHandleAsync(context, new InvalidOperationException("boom"), CancellationToken.None);

        Assert.True(handled);
        Assert.Equal(1, logger.Errors);
        Assert.Equal(500, context.Response.StatusCode);
    }
}
