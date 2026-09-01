using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class DswDesktopLauncher
{
    private const string Url = "http://127.0.0.1:8090/";
    private const string HostDirectory = @"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\dex-2dphys.github.io\dsw";
    private const string PluginDirectory = @"C:\Users\pbog\Dropbox\ACTIVITIES\00 VSCODE\DSW\Plugins";

    [STAThread]
    private static void Main()
    {
        try
        {
            if (!IsDswReady())
            {
                StartHost();
                WaitForHost();
            }

            PointHostAtWorkspace();
            Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "DSW could not be started.\r\n\r\n" + ex.Message,
                "Digital Science Workstation",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }

    private static bool IsDswReady()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Url + "api/config");
            request.Timeout = 750;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                return response.StatusCode == HttpStatusCode.OK;
        }
        catch
        {
            return false;
        }
    }

    private static void StartHost()
    {
        string host = Path.Combine(HostDirectory, "dsw.exe");
        if (!File.Exists(host))
            throw new FileNotFoundException("The DSW host was not found.", host);
        if (!Directory.Exists(PluginDirectory))
            throw new DirectoryNotFoundException("The DSW plugin workspace was not found: " + PluginDirectory);

        Process.Start(new ProcessStartInfo
        {
            FileName = host,
            Arguments = "--plugins \"" + PluginDirectory + "\"",
            WorkingDirectory = HostDirectory,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        });
    }

    private static void WaitForHost()
    {
        DateTime deadline = DateTime.UtcNow.AddSeconds(12);
        while (DateTime.UtcNow < deadline)
        {
            if (IsDswReady())
                return;
            Thread.Sleep(250);
        }

        throw new InvalidOperationException("The host did not respond on port 8090 within 12 seconds.");
    }

    private static void PointHostAtWorkspace()
    {
        string json = "{\"library\":\"" + PluginDirectory.Replace("\\", "\\\\") + "\"}";
        byte[] body = Encoding.UTF8.GetBytes(json);
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Url + "api/config");
        request.Method = "POST";
        request.ContentType = "application/json; charset=utf-8";
        request.ContentLength = body.Length;
        request.Timeout = 5000;
        using (Stream stream = request.GetRequestStream())
            stream.Write(body, 0, body.Length);
        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        {
            if (response.StatusCode != HttpStatusCode.OK)
                throw new InvalidOperationException("The host rejected the DSW workspace plugin folder.");
        }
    }
}
