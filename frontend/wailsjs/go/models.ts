export namespace adapter {
	
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
	        this.ModTime = source["ModTime"];
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
	    Region: string;
	    DERPMapURL: string;

	    static createFrom(source: any = {}) {
	        return new Settings(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Region = source["Region"];
	        this.DERPMapURL = source["DERPMapURL"];
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

