//go:build !(windows || darwin)

package tray

func (c *Controller) Start(icon []byte) {
	_ = icon
}
