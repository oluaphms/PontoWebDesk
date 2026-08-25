using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;

namespace PontoWebDesk
{
    public sealed class HostConfig
    {
        public string ServiceName = "PontoWebDeskHost";
        public string Executable = "";
        public string Argument = "";
        public string WorkingDirectory = "";
        public string StdoutLog = "";
        public string StderrLog = "";
        public string EnvFile = "";
    }

    public sealed class ChildService : ServiceBase
    {
        private readonly HostConfig _cfg;
        private Process _child;
        private StreamWriter _outLog;
        private StreamWriter _errLog;

        public ChildService(HostConfig cfg)
        {
            _cfg = cfg;
            this.ServiceName = cfg.ServiceName;
            this.CanStop = true;
            this.CanShutdown = true;
            this.AutoLog = true;
        }

        protected override void OnStart(string[] args)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_cfg.StdoutLog) ?? ".");
            _outLog = new StreamWriter(_cfg.StdoutLog, true, Encoding.UTF8) { AutoFlush = true };
            _errLog = new StreamWriter(_cfg.StderrLog, true, Encoding.UTF8) { AutoFlush = true };

            var psi = new ProcessStartInfo();
            psi.FileName = _cfg.Executable;
            psi.Arguments = Quote(_cfg.Argument);
            psi.WorkingDirectory = string.IsNullOrEmpty(_cfg.WorkingDirectory)
                ? Path.GetDirectoryName(_cfg.Executable)
                : _cfg.WorkingDirectory;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            ApplyEnvFile(psi, _cfg.EnvFile);

            _child = new Process();
            _child.StartInfo = psi;
            _child.EnableRaisingEvents = true;
            _child.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null && _outLog != null) _outLog.WriteLine(e.Data);
            };
            _child.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
            {
                if (e.Data != null && _errLog != null) _errLog.WriteLine(e.Data);
            };
            _child.Exited += delegate
            {
                try { this.Stop(); }
                catch { }
            };

            if (!_child.Start())
            {
                throw new InvalidOperationException("CHILD_START_FAILED: " + _cfg.Executable);
            }
            _child.BeginOutputReadLine();
            _child.BeginErrorReadLine();
        }

        protected override void OnStop()
        {
            try
            {
                if (_child != null && !_child.HasExited)
                {
                    _child.Kill();
                    _child.WaitForExit(8000);
                }
            }
            catch { }
            try { if (_outLog != null) _outLog.Close(); } catch { }
            try { if (_errLog != null) _errLog.Close(); } catch { }
        }

        private static string Quote(string path)
        {
            if (string.IsNullOrEmpty(path)) return "";
            if (path.IndexOf(' ') >= 0 && !path.StartsWith("\"")) return "\"" + path + "\"";
            return path;
        }

        private static void ApplyEnvFile(ProcessStartInfo psi, string envFile)
        {
            if (string.IsNullOrEmpty(envFile) || !File.Exists(envFile)) return;
            foreach (var raw in File.ReadAllLines(envFile))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var key = line.Substring(0, eq).Trim();
                var val = line.Substring(eq + 1).Trim();
                if (key.Length == 0) continue;
                psi.EnvironmentVariables[key] = val;
            }
        }
    }

    public static class Program
    {
        public static int Main(string[] args)
        {
            try
            {
                var cfgPath = args != null && args.Length > 0 ? args[0] : "";
                if (string.IsNullOrEmpty(cfgPath) || !File.Exists(cfgPath))
                {
                    Console.Error.WriteLine("PWD_SERVICE_HOST_CONFIG_MISSING");
                    return 2;
                }
                var cfg = LoadConfig(cfgPath);
                if (string.IsNullOrEmpty(cfg.Executable) || !File.Exists(cfg.Executable))
                {
                    Console.Error.WriteLine("PWD_SERVICE_HOST_EXE_MISSING: " + cfg.Executable);
                    return 3;
                }
                ServiceBase.Run(new ServiceBase[] { new ChildService(cfg) });
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex);
                return 1;
            }
        }

        public static HostConfig LoadConfig(string path)
        {
            var cfg = new HostConfig();
            foreach (var raw in File.ReadAllLines(path))
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var key = line.Substring(0, eq).Trim();
                var val = line.Substring(eq + 1).Trim();
                if (key == "serviceName") cfg.ServiceName = val;
                else if (key == "executable") cfg.Executable = val;
                else if (key == "argument") cfg.Argument = val;
                else if (key == "workingDirectory") cfg.WorkingDirectory = val;
                else if (key == "stdoutLog") cfg.StdoutLog = val;
                else if (key == "stderrLog") cfg.StderrLog = val;
                else if (key == "envFile") cfg.EnvFile = val;
            }
            return cfg;
        }
    }
}
