// A test fixture, not a product feature. BloomLoop never authors teaching content
// - that veto is explicit ("we will not make PPT"). This is one chapter's worth of
// text checked in purely so `npm run seed`, the smoke test and a dry run all work
// on a laptop with no class PPT to hand.
//
// Replace it on demo day by uploading the teacher's actual chapter deck.

export const SAMPLE = {
  title: 'Computer Networks - Unit 4: The Transport Layer (sample)',

  topics: [
    'Transport layer services',
    'User Datagram Protocol',
    'Transmission Control Protocol',
    'TCP connection establishment',
    'Flow control and the sliding window',
    'Congestion control',
  ],

  rawText: `
Transport layer services.
The transport layer provides logical communication between application processes running on
different hosts. It takes messages from the application layer, breaks them into segments, and
passes them to the network layer. Its core services are process-to-process delivery,
multiplexing and demultiplexing, and, depending on the protocol chosen, reliability, flow
control and congestion control. Multiplexing is the gathering of data from multiple
application sockets at the sender; demultiplexing is the delivery of an arriving segment to
the correct socket at the receiver, using the port numbers in the segment header. A port
number is a 16-bit identifier, so ports range from 0 to 65535, with 0 to 1023 reserved as
well-known ports.

User Datagram Protocol.
UDP is a connectionless transport protocol. It adds almost nothing to the service of the
network layer: a source port, a destination port, a length field and a checksum, for a total
header size of 8 bytes. UDP performs no handshake, no acknowledgement, no retransmission and
no congestion control, so datagrams may be lost, duplicated or reordered. This makes UDP
suitable for applications that value low latency over reliability, such as DNS queries, live
voice and video, and online gaming. The absence of connection state also lets a UDP server
support very large numbers of clients cheaply.

Transmission Control Protocol.
TCP is a connection-oriented, reliable, byte-stream protocol. Its header is 20 bytes without
options. TCP achieves reliability with sequence numbers, cumulative acknowledgements,
checksums, and retransmission driven by a timeout whose value is derived from an estimate of
the round-trip time. The retransmission timeout is calculated from a smoothed round-trip time
estimate plus a multiple of the deviation, so that a network with variable delay does not
cause spurious retransmissions. TCP also implements fast retransmit: three duplicate
acknowledgements for the same sequence number are taken as a loss signal, and the segment is
resent without waiting for the timer to expire.

TCP connection establishment.
A TCP connection is opened with a three-way handshake. The client sends a SYN segment carrying
its initial sequence number. The server replies with a SYN-ACK, carrying its own initial
sequence number and acknowledging the client's. The client replies with an ACK, and the
connection enters the ESTABLISHED state. The handshake exists so that both ends agree on
starting sequence numbers and on each other's willingness to communicate. Connection release
is a four-way exchange of FIN and ACK segments, because each direction of the byte stream is
closed independently. The TIME_WAIT state, held for twice the maximum segment lifetime, allows
delayed duplicate segments to drain from the network before the port pair is reused.

Flow control and the sliding window.
Flow control stops a fast sender from overwhelming a slow receiver. TCP implements it with a
sliding window: every acknowledgement carries a receive window field advertising how much free
buffer space the receiver currently has, and the sender must keep its unacknowledged data
within that advertised window. A receiver whose buffer fills advertises a window of zero,
which halts the sender; the sender then probes periodically with a window probe segment so the
connection does not deadlock when the reopening advertisement is lost. Flow control is
strictly an end-to-end concern between the two hosts, and is independent of the state of the
network between them.

Congestion control.
Congestion control protects the network itself, rather than the receiver, from being
overloaded. TCP maintains a congestion window in addition to the receive window, and the
amount of data in flight is limited by the smaller of the two. In slow start the congestion
window begins at one maximum segment size and doubles every round-trip time, growing
exponentially until it reaches the slow-start threshold. Above that threshold the connection
enters congestion avoidance, where the window grows by roughly one segment per round-trip
time, a linear increase. On a loss detected by three duplicate acknowledgements, TCP Reno
halves the window and continues in congestion avoidance, a behaviour known as fast recovery;
on a loss detected by timeout, the window drops back to one segment and slow start begins
again. This overall pattern is called additive increase, multiplicative decrease, and it is
what allows many independent TCP connections to converge on a fair share of a bottleneck link.
`.trim(),
};
