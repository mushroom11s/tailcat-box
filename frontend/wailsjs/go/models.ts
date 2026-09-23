export namespace adapter {
	
	export class FileEntry {
	    Name: string;
	    IsDir: boolean;
	    Size: number;
	    Mode: string;
	    // Go type: time
	    ModTime: any;
	
	    static createFrom(source: any = {}) {
	        return new FileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.IsDir = source["IsDir"];
	        this.Size = source["Size"];
	        this.Mode = source["Mode"];
	        this.ModTime = this.convertValues(source["ModTime"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PortMapping {
	    LocalPort: number;
	    RemoteHost: string;
	    RemotePort: number;
	
	    static createFrom(source: any = {}) {
	        return new PortMapping(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.LocalPort = source["LocalPort"];
	        this.RemoteHost = source["RemoteHost"];
	        this.RemotePort = source["RemotePort"];
	    }
	}

}

export namespace main {
	
	export class ClientInfo {
	    StartedAt: string;
	    AppVersion: string;
	    TailcatVersion: string;
	    LastUpdateCheck: string;
	
	    static createFrom(source: any = {}) {
	        return new ClientInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.StartedAt = source["StartedAt"];
	        this.AppVersion = source["AppVersion"];
	        this.TailcatVersion = source["TailcatVersion"];
	        this.LastUpdateCheck = source["LastUpdateCheck"];
	    }
	}
	export class UpdateStatus {
	    CurrentVersion: string;
	    LatestVersion: string;
	    LatestTag: string;
	    UpdateAvailable: boolean;
	    Notes: string;
	    ReleaseURL: string;
	    AssetName: string;
	    DownloadURL: string;
	    LastChecked: string;
	    Status: string;
	    Error: string;
	    DownloadedPath: string;
	    ProgressPercent: number;
	    Platform: string;
	
	    static createFrom(source: any = {}) {
	        return new UpdateStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.CurrentVersion = source["CurrentVersion"];
	        this.LatestVersion = source["LatestVersion"];
	        this.LatestTag = source["LatestTag"];
	        this.UpdateAvailable = source["UpdateAvailable"];
	        this.Notes = source["Notes"];
	        this.ReleaseURL = source["ReleaseURL"];
	        this.AssetName = source["AssetName"];
	        this.DownloadURL = source["DownloadURL"];
	        this.LastChecked = source["LastChecked"];
	        this.Status = source["Status"];
	        this.Error = source["Error"];
	        this.DownloadedPath = source["DownloadedPath"];
	        this.ProgressPercent = source["ProgressPercent"];
	        this.Platform = source["Platform"];
	    }
	}
	export class SystemInfo {
	    OSVersion: string;
	    LaunchAtLogin: boolean;
	    LaunchAtLoginSupported: boolean;
	    NetworkOnline: boolean;
	    NetworkSummary: string;
	
	    static createFrom(source: any = {}) {
	        return new SystemInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.OSVersion = source["OSVersion"];
	        this.LaunchAtLogin = source["LaunchAtLogin"];
	        this.LaunchAtLoginSupported = source["LaunchAtLoginSupported"];
	        this.NetworkOnline = source["NetworkOnline"];
	        this.NetworkSummary = source["NetworkSummary"];
	    }
	}

}

export namespace session {
	
	export class Session {
	    ID: string;
	    Kind: string;
	    Status: string;
	    Address: string;
	    // Go type: time
	    CreatedAt: any;
	    Err: string;
	    Progress: string;
	    Dangerous: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Kind = source["Kind"];
	        this.Status = source["Status"];
	        this.Address = source["Address"];
	        this.CreatedAt = this.convertValues(source["CreatedAt"], null);
	        this.Err = source["Err"];
	        this.Progress = source["Progress"];
	        this.Dangerous = source["Dangerous"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace store {
	
	export class KeyInfo {
	    Name: string;
	    Path: string;
	    Client: boolean;
	    Address: string;
	    Source: string;
	
	    static createFrom(source: any = {}) {
	        return new KeyInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Path = source["Path"];
	        this.Client = source["Client"];
	        this.Address = source["Address"];
	        this.Source = source["Source"];
	    }
	}
	export class Settings {
	    region: string;
	    derpMapUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.region = source["region"];
	        this.derpMapUrl = source["derpMapUrl"];
	    }
	}

}

