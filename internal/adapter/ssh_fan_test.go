package adapter

import "testing"

func TestSubscribeReplaySurvivesCancel(t *testing.T) {
	for i := 0; i < 2000; i++ {
		fan := newSSHFan()
		for n := 0; n < 8; n++ {
			fan.publish([]byte("connected\r\n"))
		}
		_, cancel := fan.subscribe()
		cancel()
	}
}
