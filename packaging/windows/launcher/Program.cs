using System.Diagnostics;
using System.IO;
using System.Reflection;
using System;

var tempDirectory = Path.Combine(Path.GetTempPath(), "express-boilerplate-installer");
Directory.CreateDirectory(tempDirectory);
var msiPath = Path.Combine(tempDirectory, "express-boilerplate.msi");

await using (var resource = Assembly.GetExecutingAssembly()
    .GetManifestResourceStream("installer.msi")
    ?? throw new InvalidOperationException("Embedded installer payload is missing."))
await using (var output = File.Create(msiPath))
{
    await resource.CopyToAsync(output);
}

using var installer = Process.Start(new ProcessStartInfo
{
    FileName = "msiexec.exe",
    Arguments = $"/i \"{msiPath}\"",
    UseShellExecute = true,
});
installer?.WaitForExit();
