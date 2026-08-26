# Installing Itixo.ComponentLibrary.Tables

The package publishes to a private GitHub Packages NuGet feed under `ITIXO`, alongside `nuget.org`. Consumers need a `nuget.config` with package source mapping, not just the default `nuget.org` source, or `dotnet restore` will fail to find `Itixo.*` packages.

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
    <packageSources>
        <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
        <add key="github" value="https://nuget.pkg.github.com/ITIXO/index.json" />
    </packageSources>
    <packageSourceMapping>
        <packageSource key="nuget.org">
            <package pattern="*" />
        </packageSource>
        <packageSource key="github">
            <package pattern="Itixo.*" />
        </packageSource>
    </packageSourceMapping>
</configuration>
```

Place `nuget.config` at the solution/repo root, or in the directory `dotnet restore` runs from. The `github` source needs GitHub Packages authentication (for example a PAT with `read:packages` scope, or an existing configured credential) — GitHub Packages NuGet feeds require auth even for read access. Readers must supply this credential themselves.
