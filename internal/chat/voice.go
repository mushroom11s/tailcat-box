package chat

import (
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"

	"github.com/tphakala/go-opus/opus"
)

const (
	portVoice = 103
	voiceMIME = "audio/webm;codecs=opus"
)

// TranscodeVoice returns audio/webm;codecs=opus bytes. A WebM/Opus payload is
// sent unchanged. PCM is encoded so current Tailcatchat in Chrome can play it.
func TranscodeVoice(mime string, audio []byte) (string, []byte, error) {
	if len(audio) == 0 {
		return "", nil, fmt.Errorf("empty voice")
	}
	if isWebM(mime) {
		return voiceMIME, audio, nil
	}
	rate, channels, ok := parsePCMLayout(mime)
	if !ok {
		return "", nil, fmt.Errorf("unsupported voice mime")
	}
	if len(audio)%2 != 0 {
		return "", nil, fmt.Errorf("pcm length")
	}
	samples := bytesToInt16(audio)
	if channels == 0 || len(samples)%channels != 0 {
		return "", nil, fmt.Errorf("pcm channels")
	}
	samples = resample(samples, channels, rate, 48000)
	payload, err := encodeWebMOpus(samples, channels)
	if err != nil {
		return "", nil, err
	}
	return voiceMIME, payload, nil
}

// DecodeVoiceWAV returns 16-bit PCM WAV for a voice payload the webview cannot play.
func DecodeVoiceWAV(mime string, audio []byte) ([]byte, error) {
	if len(audio) >= 12 && string(audio[:4]) == "RIFF" && string(audio[8:12]) == "WAVE" {
		return append([]byte(nil), audio...), nil
	}
	if rate, channels, ok := parsePCMLayout(mime); ok {
		if len(audio)%2 != 0 || len(audio) == 0 {
			return nil, fmt.Errorf("pcm length")
		}
		return writeWAV(bytesToInt16(audio), rate, channels), nil
	}
	channels, preSkip, packets, err := extractOpus(audio)
	if err != nil {
		return nil, err
	}
	if len(packets) == 0 {
		return nil, fmt.Errorf("no opus packets")
	}
	dec, err := opus.NewDecoder(48000, channels)
	if err != nil {
		return nil, err
	}
	buf := make([]int16, 5760*channels)
	var pcm []int16
	for _, pkt := range packets {
		n, err := dec.Decode(pkt, buf)
		if err != nil {
			return nil, err
		}
		if n < 0 {
			return nil, fmt.Errorf("opus decode")
		}
		pcm = append(pcm, buf[:n*channels]...)
	}
	skip := preSkip * channels
	if skip > len(pcm) {
		return nil, fmt.Errorf("opus pre-skip")
	}
	return writeWAV(pcm[skip:], 48000, channels), nil
}

func (s *Service) SendVoice(mime string, durationSec int, audio []byte, burn bool, ttlSec int) error {
	if len(audio) == 0 {
		return nil
	}
	if durationSec < 1 {
		durationSec = 1
	}
	s.mu.Lock()
	if s.peer == "" || s.room == nil || s.sess == nil {
		s.mu.Unlock()
		return fmt.Errorf("no peer")
	}
	room := s.room
	sid := s.sess.ID
	s.mu.Unlock()
	outMime, payload, err := TranscodeVoice(mime, audio)
	if err != nil {
		return err
	}
	meta := map[string]any{"type": "voice", "mime": outMime, "duration": durationSec}
	applyBurn(meta, burn, ttlSec)
	frame, err := Pack(meta, payload)
	if err != nil {
		return err
	}
	if err := s.dial(s.transferContext(), room, portVoice, frame); err != nil {
		return fmt.Errorf("%s", errUnreachable)
	}
	s.addVoice(sid, "out", outMime, durationSec, payload, burn, ttlSec)
	return nil
}

func (s *Service) onVoice(sessionID string, meta map[string]any, payload []byte) {
	mime, _ := meta["mime"].(string)
	if mime == "" {
		mime = "application/octet-stream"
	}
	duration := int(asInt(meta["duration"]))
	if duration < 1 {
		duration = 1
	}
	burn, ttl := readBurn(meta)
	s.addVoice(sessionID, "in", mime, duration, payload, burn, ttl)
}

func (s *Service) addVoice(sessionID, direction, mime string, duration int, audio []byte, burn bool, ttl int) {
	msg := newMessage(direction, "voice", "", "")
	msg.Mime = mime
	msg.Duration = duration
	msg.Size = int64(len(audio))
	msg.Audio = base64.StdEncoding.EncodeToString(audio)
	if burn {
		msg.Burn = true
		msg.TTLSec = clampTTL(ttl)
	}
	s.mu.Lock()
	s.messages = append(s.messages, msg)
	s.mu.Unlock()
	s.emitMessage(sessionID, msg)
}

func isWebM(mime string) bool {
	return strings.Contains(strings.ToLower(mime), "webm")
}

func parsePCMLayout(mime string) (int, int, bool) {
	m := strings.ToLower(strings.TrimSpace(mime))
	if !strings.HasPrefix(m, "audio/pcm") && !strings.HasPrefix(m, "audio/l16") && !strings.HasPrefix(m, "audio/x-raw") {
		return 0, 0, false
	}
	rate, channels := 48000, 1
	for _, part := range strings.Split(m, ";") {
		part = strings.TrimSpace(part)
		switch {
		case strings.HasPrefix(part, "rate="):
			if n, err := strconv.Atoi(strings.TrimPrefix(part, "rate=")); err == nil && n > 0 {
				rate = n
			}
		case strings.HasPrefix(part, "channels="):
			if n, err := strconv.Atoi(strings.TrimPrefix(part, "channels=")); err == nil && n > 0 {
				channels = n
			}
		}
	}
	if channels < 1 || channels > 2 {
		return 0, 0, false
	}
	return rate, channels, true
}

func bytesToInt16(b []byte) []int16 {
	out := make([]int16, len(b)/2)
	for i := range out {
		out[i] = int16(binary.LittleEndian.Uint16(b[i*2:]))
	}
	return out
}

func resample(in []int16, channels, from, to int) []int16 {
	if from == to || len(in) == 0 {
		return in
	}
	frames := len(in) / channels
	outFrames := int(math.Round(float64(frames) * float64(to) / float64(from)))
	if outFrames < 1 {
		outFrames = 1
	}
	out := make([]int16, outFrames*channels)
	for i := 0; i < outFrames; i++ {
		src := float64(i) * float64(from) / float64(to)
		i0 := int(math.Floor(src))
		frac := src - float64(i0)
		if i0 < 0 {
			i0 = 0
		}
		i1 := i0 + 1
		if i0 >= frames {
			i0 = frames - 1
		}
		if i1 >= frames {
			i1 = frames - 1
		}
		for c := 0; c < channels; c++ {
			a := float64(in[i0*channels+c])
			b := float64(in[i1*channels+c])
			out[i*channels+c] = int16(math.Round(a + (b-a)*frac))
		}
	}
	return out
}

func encodeWebMOpus(pcm []int16, channels int) ([]byte, error) {
	enc, err := opus.NewEncoder(opus.EncoderConfig{
		SampleRate: 48000,
		Channels:   channels,
		Bitrate:    32000 * channels,
		Complexity: 5,
	})
	if err != nil {
		return nil, err
	}
	const frame = 960
	samples := len(pcm) / channels
	if pad := (frame - samples%frame) % frame; pad > 0 {
		pcm = append(append([]int16{}, pcm...), make([]int16, pad*channels)...)
		samples += pad
	}
	buf := make([]byte, 4000)
	packets := make([][]byte, 0, samples/frame)
	for off := 0; off < samples; off += frame {
		n, err := enc.Encode(pcm[off*channels:(off+frame)*channels], buf)
		if err != nil {
			return nil, err
		}
		packets = append(packets, append([]byte(nil), buf[:n]...))
	}
	return muxWebMOpus(packets, channels, enc.PreSkip()), nil
}

func writeWAV(pcm []int16, rate, channels int) []byte {
	dataBytes := len(pcm) * 2
	buf := make([]byte, 44+dataBytes)
	copy(buf[0:], "RIFF")
	binary.LittleEndian.PutUint32(buf[4:], uint32(36+dataBytes))
	copy(buf[8:], "WAVE")
	copy(buf[12:], "fmt ")
	binary.LittleEndian.PutUint32(buf[16:], 16)
	binary.LittleEndian.PutUint16(buf[20:], 1)
	binary.LittleEndian.PutUint16(buf[22:], uint16(channels))
	binary.LittleEndian.PutUint32(buf[24:], uint32(rate))
	binary.LittleEndian.PutUint32(buf[28:], uint32(rate*channels*2))
	binary.LittleEndian.PutUint16(buf[32:], uint16(channels*2))
	binary.LittleEndian.PutUint16(buf[34:], 16)
	copy(buf[36:], "data")
	binary.LittleEndian.PutUint32(buf[40:], uint32(dataBytes))
	for i, sample := range pcm {
		binary.LittleEndian.PutUint16(buf[44+i*2:], uint16(sample))
	}
	return buf
}

var (
	idEBML               = []byte{0x1A, 0x45, 0xDF, 0xA3}
	idEBMLVersion        = []byte{0x42, 0x86}
	idEBMLReadVersion    = []byte{0x42, 0xF7}
	idEBMLMaxIDLength    = []byte{0x42, 0xF2}
	idEBMLMaxSizeLength  = []byte{0x42, 0xF3}
	idDocType            = []byte{0x42, 0x82}
	idDocTypeVersion     = []byte{0x42, 0x87}
	idDocTypeReadVersion = []byte{0x42, 0x85}
	idSegment            = []byte{0x18, 0x53, 0x80, 0x67}
	idInfo               = []byte{0x15, 0x49, 0xA9, 0x66}
	idTimecodeScale      = []byte{0x2A, 0xD7, 0xB1}
	idMuxingApp          = []byte{0x4D, 0x80}
	idWritingApp         = []byte{0x57, 0x41}
	idDuration           = []byte{0x44, 0x89}
	idTracks             = []byte{0x16, 0x54, 0xAE, 0x6B}
	idTrackEntry         = []byte{0xAE}
	idTrackNumber        = []byte{0xD7}
	idTrackUID           = []byte{0x73, 0xC5}
	idTrackType          = []byte{0x83}
	idCodecID            = []byte{0x86}
	idCodecPrivate       = []byte{0x63, 0xA2}
	idCodecDelay         = []byte{0x56, 0xAA}
	idSeekPreRoll        = []byte{0x56, 0xBB}
	idDefaultDuration    = []byte{0x23, 0xE3, 0x83}
	idAudio              = []byte{0xE1}
	idSamplingFrequency  = []byte{0xB5}
	idChannels           = []byte{0x9F}
	idCluster            = []byte{0x1F, 0x43, 0xB6, 0x75}
	idTimecode           = []byte{0xE7}
	idSimpleBlock        = []byte{0xA3}
	idBlockGroup         = []byte{0xA0}
	idBlock              = []byte{0xA1}
)

func muxWebMOpus(packets [][]byte, channels, preSkip int) []byte {
	header := ebml(idEBML, concat(
		ebmlUint(idEBMLVersion, 1),
		ebmlUint(idEBMLReadVersion, 1),
		ebmlUint(idEBMLMaxIDLength, 4),
		ebmlUint(idEBMLMaxSizeLength, 8),
		ebmlString(idDocType, "webm"),
		ebmlUint(idDocTypeVersion, 4),
		ebmlUint(idDocTypeReadVersion, 2),
	))
	info := ebml(idInfo, concat(
		ebmlUint(idTimecodeScale, 1_000_000),
		ebmlString(idMuxingApp, "tailcat-box"),
		ebmlString(idWritingApp, "tailcat-box"),
		ebmlFloat(idDuration, float64(len(packets)*20)),
	))
	track := ebml(idTrackEntry, concat(
		ebmlUint(idTrackNumber, 1),
		ebmlUint(idTrackUID, 1),
		ebmlUint(idTrackType, 2),
		ebmlString(idCodecID, "A_OPUS"),
		ebml(idCodecPrivate, opusHead(channels, preSkip)),
		ebmlUint(idCodecDelay, uint64(preSkip)*1_000_000_000/48000),
		ebmlUint(idSeekPreRoll, 80_000_000),
		ebmlUint(idDefaultDuration, 20_000_000),
		ebml(idAudio, concat(
			ebmlFloat(idSamplingFrequency, 48000),
			ebmlUint(idChannels, uint64(channels)),
		)),
	))
	return concat(header, ebml(idSegment, concat(info, ebml(idTracks, track), webmClusters(packets))))
}

func opusHead(channels, preSkip int) []byte {
	b := make([]byte, 19)
	copy(b, "OpusHead")
	b[8] = 1
	b[9] = byte(channels)
	binary.LittleEndian.PutUint16(b[10:], uint16(preSkip))
	binary.LittleEndian.PutUint32(b[12:], 48000)
	return b
}

func webmClusters(packets [][]byte) []byte {
	var out []byte
	start := 0
	var blocks []byte
	flush := func(next int) {
		if len(blocks) == 0 {
			return
		}
		out = append(out, ebml(idCluster, concat(ebmlUint(idTimecode, uint64(start*20)), blocks))...)
		start = next
		blocks = nil
	}
	for i, pkt := range packets {
		rel := (i - start) * 20
		if rel > 30000 {
			flush(i)
			rel = 0
		}
		blocks = append(blocks, simpleBlock(1, int16(rel), pkt)...)
	}
	flush(len(packets))
	return out
}

func simpleBlock(track int, timecode int16, packet []byte) []byte {
	body := make([]byte, 0, 4+len(packet))
	body = append(body, byte(0x80|track))
	body = append(body, byte(timecode>>8), byte(timecode))
	body = append(body, 0x80)
	body = append(body, packet...)
	return ebml(idSimpleBlock, body)
}

func ebml(id, payload []byte) []byte {
	return concat(id, encodeSize(uint64(len(payload))), payload)
}

func ebmlUint(id []byte, v uint64) []byte {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], v)
	i := 0
	for i < 7 && buf[i] == 0 {
		i++
	}
	return ebml(id, buf[i:])
}

func ebmlFloat(id []byte, f float64) []byte {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], math.Float64bits(f))
	return ebml(id, buf[:])
}

func ebmlString(id []byte, s string) []byte {
	return ebml(id, []byte(s))
}

func encodeSize(n uint64) []byte {
	switch {
	case n < 0x7F:
		return []byte{byte(n) | 0x80}
	case n < 0x3FFF:
		return []byte{byte(n>>8) | 0x40, byte(n)}
	case n < 0x1FFFFF:
		return []byte{byte(n>>16) | 0x20, byte(n >> 8), byte(n)}
	case n < 0x0FFFFFFF:
		return []byte{byte(n>>24) | 0x10, byte(n >> 16), byte(n >> 8), byte(n)}
	default:
		b := make([]byte, 8)
		binary.BigEndian.PutUint64(b, n)
		b[0] |= 0x01
		return b
	}
}

func concat(parts ...[]byte) []byte {
	n := 0
	for _, part := range parts {
		n += len(part)
	}
	out := make([]byte, 0, n)
	for _, part := range parts {
		out = append(out, part...)
	}
	return out
}

type ebmlEl struct {
	id      []byte
	payload []byte
}

func children(buf []byte) ([]ebmlEl, error) {
	var out []ebmlEl
	i := 0
	for i < len(buf) {
		for i < len(buf) && buf[i] == 0 {
			i++
		}
		if i >= len(buf) {
			break
		}
		id, n, err := readID(buf[i:])
		if err != nil {
			return nil, err
		}
		i += n
		sz, m, unknown, err := readVint(buf[i:])
		if err != nil {
			return nil, err
		}
		i += m
		var payload []byte
		if unknown {
			payload = buf[i:]
			i = len(buf)
		} else {
			if uint64(len(buf)-i) < sz {
				return nil, io.ErrUnexpectedEOF
			}
			payload = buf[i : i+int(sz)]
			i += int(sz)
		}
		out = append(out, ebmlEl{id: append([]byte(nil), id...), payload: payload})
	}
	return out, nil
}

func readID(b []byte) ([]byte, int, error) {
	if len(b) == 0 || b[0] == 0 {
		return nil, 0, fmt.Errorf("bad id")
	}
	length := 1
	mask := byte(0x80)
	for b[0]&mask == 0 {
		mask >>= 1
		length++
		if length > 4 {
			return nil, 0, fmt.Errorf("bad id")
		}
	}
	if len(b) < length {
		return nil, 0, io.ErrUnexpectedEOF
	}
	return b[:length], length, nil
}

func readVint(b []byte) (uint64, int, bool, error) {
	if len(b) == 0 || b[0] == 0 {
		return 0, 0, false, fmt.Errorf("bad vint")
	}
	length := 1
	mask := byte(0x80)
	for b[0]&mask == 0 {
		mask >>= 1
		length++
		if length > 8 {
			return 0, 0, false, fmt.Errorf("bad vint")
		}
	}
	if len(b) < length {
		return 0, 0, false, io.ErrUnexpectedEOF
	}
	var v uint64
	for i := 0; i < length; i++ {
		v = (v << 8) | uint64(b[i])
	}
	v &^= uint64(mask) << (8 * (length - 1))
	unknown := v == (uint64(1)<<uint(7*length))-1
	return v, length, unknown, nil
}

func readSignedVint(b []byte) (int64, int, error) {
	u, n, _, err := readVint(b)
	if err != nil {
		return 0, 0, err
	}
	bias := (int64(1) << (7*n - 1)) - 1
	return int64(u) - bias, n, nil
}

func extractOpus(data []byte) (int, int, [][]byte, error) {
	roots, err := children(data)
	if err != nil {
		return 0, 0, nil, err
	}
	var segment []byte
	for _, item := range roots {
		if bytesEqual(item.id, idSegment) {
			segment = item.payload
		}
	}
	if segment == nil {
		return 0, 0, nil, fmt.Errorf("no segment")
	}
	parts, err := children(segment)
	if err != nil {
		return 0, 0, nil, err
	}
	track, channels, preSkip := 1, 0, 0
	found := false
	for _, part := range parts {
		if !bytesEqual(part.id, idTracks) {
			continue
		}
		entries, err := children(part.payload)
		if err != nil {
			return 0, 0, nil, err
		}
		for _, entry := range entries {
			if !bytesEqual(entry.id, idTrackEntry) {
				continue
			}
			num, ch, skip, opusTrack := inspectTrack(entry.payload)
			if opusTrack {
				track, channels, preSkip, found = num, ch, skip, true
			}
		}
	}
	if !found {
		return 0, 0, nil, fmt.Errorf("no opus track")
	}
	var packets [][]byte
	for _, part := range parts {
		if !bytesEqual(part.id, idCluster) {
			continue
		}
		packets = append(packets, clusterPackets(part.payload, track)...)
	}
	return channels, preSkip, packets, nil
}

func inspectTrack(payload []byte) (int, int, int, bool) {
	els, err := children(payload)
	if err != nil {
		return 1, 0, 0, false
	}
	num := 1
	channels, preSkip := 0, 0
	opusTrack := false
	for _, item := range els {
		switch {
		case bytesEqual(item.id, idTrackNumber):
			num = int(readUint(item.payload))
		case bytesEqual(item.id, idCodecPrivate) && len(item.payload) >= 8 && string(item.payload[:8]) == "OpusHead":
			ch, skip, err := parseOpusHead(item.payload)
			if err == nil {
				channels, preSkip, opusTrack = ch, skip, true
			}
		}
	}
	if num < 1 {
		num = 1
	}
	return num, channels, preSkip, opusTrack
}

func parseOpusHead(b []byte) (int, int, error) {
	if len(b) < 19 || string(b[:8]) != "OpusHead" || b[8] != 1 {
		return 0, 0, fmt.Errorf("bad opus head")
	}
	channels := int(b[9])
	if channels < 1 || channels > 2 {
		return 0, 0, fmt.Errorf("unsupported channels")
	}
	return channels, int(binary.LittleEndian.Uint16(b[10:12])), nil
}

func clusterPackets(payload []byte, track int) [][]byte {
	els, err := children(payload)
	if err != nil {
		return nil
	}
	var out [][]byte
	for _, item := range els {
		switch {
		case bytesEqual(item.id, idSimpleBlock):
			out = append(out, framesForTrack(item.payload, track)...)
		case bytesEqual(item.id, idBlockGroup):
			inner, err := children(item.payload)
			if err != nil {
				continue
			}
			for _, child := range inner {
				if bytesEqual(child.id, idBlock) {
					out = append(out, framesForTrack(child.payload, track)...)
				}
			}
		}
	}
	return out
}

func framesForTrack(block []byte, track int) [][]byte {
	tr, n, _, err := readVint(block)
	if err != nil || int(tr) != track || len(block) < n+3 {
		return nil
	}
	return unlace(block[n+2], block[n+3:])
}

func unlace(flags byte, data []byte) [][]byte {
	switch flags & 0x06 {
	case 0:
		if len(data) == 0 {
			return nil
		}
		return [][]byte{append([]byte(nil), data...)}
	case 0x02:
		return laced(data, false, false)
	case 0x04:
		return laced(data, true, false)
	default:
		return laced(data, false, true)
	}
}

func laced(data []byte, fixed, ebmlLace bool) [][]byte {
	if len(data) < 1 {
		return nil
	}
	count := int(data[0]) + 1
	if count < 1 {
		return nil
	}
	if fixed {
		body := data[1:]
		if len(body)%count != 0 {
			return nil
		}
		sz := len(body) / count
		sizes := make([]int, count)
		for i := range sizes {
			sizes[i] = sz
		}
		return sliceFrames(body, sizes)
	}
	i := 1
	sizes := make([]int, count)
	if !ebmlLace {
		for f := 0; f < count-1; f++ {
			for {
				if i >= len(data) {
					return nil
				}
				sizes[f] += int(data[i])
				i++
				if data[i-1] != 255 {
					break
				}
			}
		}
	} else if count > 1 {
		sz, n, _, err := readVint(data[i:])
		if err != nil {
			return nil
		}
		sizes[0] = int(sz)
		i += n
		for f := 1; f < count-1; f++ {
			diff, n, err := readSignedVint(data[i:])
			if err != nil {
				return nil
			}
			i += n
			sizes[f] = sizes[f-1] + int(diff)
			if sizes[f] < 0 {
				return nil
			}
		}
	}
	total := 0
	for f := 0; f < count-1; f++ {
		total += sizes[f]
	}
	if i+total > len(data) {
		return nil
	}
	sizes[count-1] = len(data) - i - total
	return sliceFrames(data[i:], sizes)
}

func sliceFrames(body []byte, sizes []int) [][]byte {
	out := make([][]byte, 0, len(sizes))
	i := 0
	for _, sz := range sizes {
		if sz < 0 || i+sz > len(body) {
			return nil
		}
		out = append(out, append([]byte(nil), body[i:i+sz]...))
		i += sz
	}
	return out
}

func readUint(b []byte) uint64 {
	var v uint64
	for _, c := range b {
		v = (v << 8) | uint64(c)
	}
	return v
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
