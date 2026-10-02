param([string] $BaseUrl = 'http://localhost:5180', [switch] $PublicOnly)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(15)
$baseUri = [Uri]$BaseUrl
if (-not $baseUri.IsLoopback) {
    throw 'This smoke test is for localhost only.'
}

function Invoke-ApiCheck {
    param([string] $Method, [string] $Path, [int] $ExpectedStatus, $Body, [string] $Token)
    $request = New-Object System.Net.Http.HttpRequestMessage
    $request.Method = New-Object System.Net.Http.HttpMethod($Method)
    $request.RequestUri = [Uri]($BaseUrl.TrimEnd('/') + $Path)
    if ($null -ne $Body) {
        $request.Content = New-Object System.Net.Http.StringContent(($Body | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
    }
    if ($Token) {
        $request.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $Token)
    }
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    try {
        $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ([int]$response.StatusCode -ne $ExpectedStatus) {
            throw "$Method $Path expected $ExpectedStatus, received $([int]$response.StatusCode): $content"
        }
        Write-Output "PASS $Method $Path ($ExpectedStatus)" | Out-Host
        if ($content) {
            return ($content | ConvertFrom-Json)
        }
    } finally {
        $response.Dispose()
        $request.Dispose()
    }
}

try {
    $null = Invoke-ApiCheck GET '/api/health/live' 200
    if (-not $PublicOnly) {
        $null = Invoke-ApiCheck GET '/api/health/ready' 200
    }
    $swagger = Invoke-ApiCheck GET '/swagger/v1/swagger.json' 200
    if (-not $swagger.paths.'/api/auth/register' -or -not $swagger.components.securitySchemes.bearer) {
        throw 'Swagger is missing register or bearer authorization.'
    }
    $unauthorized = Invoke-ApiCheck GET '/api/users/me' 401
    if ($unauthorized.code -ne 'UNAUTHORIZED') { throw 'Unexpected unauthorized response.' }
    $null = Invoke-ApiCheck GET '/api/users/me' 401 -Token 'invalid-token'
    $invalid = Invoke-ApiCheck POST '/api/auth/register' 400 -Body @{ email='bad'; fullName='Buyer'; password='short' }
    if ($invalid.code -ne 'VALIDATION_ERROR') { throw 'Unexpected validation response.' }
    $null = Invoke-ApiCheck GET '/api/not-a-route' 404
    if ($PublicOnly) {
        Write-Output 'Public HTTP checks passed. SQL/register/login/profile have NOT been validated.'
        return
    }
    $email = 'smoke.' + [Guid]::NewGuid().ToString('N') + '@example.test'
    $registration = @{ email=$email; fullName='Smoke Test Buyer'; password='DemoPassword123!' }
    $registered = Invoke-ApiCheck POST '/api/auth/register' 201 -Body $registration
    if ($registered.user.PSObject.Properties.Name -contains 'passwordHash') { throw 'Password hash leaked in response.' }
    $duplicate = Invoke-ApiCheck POST '/api/auth/register' 409 -Body @{ email=$email.ToUpperInvariant(); fullName='Other Buyer'; password='DemoPassword123!' }
    if ($duplicate.code -ne 'EMAIL_ALREADY_EXISTS') { throw 'Unexpected duplicate response.' }
    $null = Invoke-ApiCheck POST '/api/auth/login' 401 -Body @{ email=$email; password='WrongPassword!' }
    $loggedIn = Invoke-ApiCheck POST '/api/auth/login' 200 -Body @{ email=$email; password='DemoPassword123!' }
    $profile = Invoke-ApiCheck GET '/api/users/me' 200 -Token $loggedIn.accessToken
    if ($profile.id -ne $registered.user.id) { throw 'Profile identity does not match registration.' }
    Write-Output "API smoke checks passed. Test user persisted: $email"
} finally {
    $client.Dispose()
}
