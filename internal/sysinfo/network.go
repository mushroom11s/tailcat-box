package sysinfo

import "net"

func listUpInterfaces() ([]string, error) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	var names []string
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil || len(addrs) == 0 {
			continue
		}
		hasIP := false
		for _, addr := range addrs {
			if addr.String() != "" {
				hasIP = true
				break
			}
		}
		if !hasIP {
			continue
		}
		names = append(names, iface.Name)
	}
	return names, nil
}
