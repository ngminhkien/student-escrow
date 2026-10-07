using System.Buffers.Binary;
using System.Text;

namespace StudentEscrow.Application.Orders;

// Structural checks, not a malware scanner or a full image/PDF renderer.
public static class EvidenceFormat
{
    public static bool IsPng(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 45 || !bytes[..8].SequenceEqual(new byte[] {137,80,78,71,13,10,26,10})) return false;
        var offset = 8;
        var hasData = false;
        while (offset <= bytes.Length - 12)
        {
            var length = BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset, 4));
            if (length > (uint)(bytes.Length - offset - 12)) return false;
            var type = bytes.Slice(offset + 4, 4);
            if (offset == 8 && (length != 13 || !type.SequenceEqual("IHDR"u8)
                || BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset + 8, 4)) == 0
                || BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset + 12, 4)) == 0)) return false;
            if (type.SequenceEqual("IDAT"u8) && length > 0) hasData = true;
            offset += (int)length + 12;
            if (type.SequenceEqual("IEND"u8)) return length == 0 && hasData && offset == bytes.Length;
        }
        return false;
    }

    public static bool IsJpeg(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length < 12 || bytes[0] != 255 || bytes[1] != 216 || bytes[^2] != 255 || bytes[^1] != 217) return false;
        var offset = 2;
        var frame = false;
        while (offset < bytes.Length - 4)
        {
            if (bytes[offset++] != 255) return false;
            while (offset < bytes.Length && bytes[offset] == 255) offset++;
            if (offset >= bytes.Length - 2) return false;
            var marker = bytes[offset++];
            if (marker is 0 or 216 or 217) return false;
            var length = BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset, 2));
            if (length < 2 || offset + length > bytes.Length - 2) return false;
            if (marker is >= 192 and <= 207 && marker is not (196 or 200 or 204))
            {
                if (length < 8 || BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset + 3, 2)) == 0
                    || BinaryPrimitives.ReadUInt16BigEndian(bytes.Slice(offset + 5, 2)) == 0) return false;
                frame = true;
            }
            if (marker == 218) return frame && length >= 6 && offset + length < bytes.Length - 2;
            offset += length;
        }
        return false;
    }

    public static bool IsPdf(byte[] bytes)
    {
        if (bytes.Length < 20 || !bytes.AsSpan(0, 5).SequenceEqual("%PDF-"u8)
            || bytes[5] is not ((byte)'1' or (byte)'2') || bytes[6] != (byte)'.' || bytes[7] is < 48 or > 57) return false;
        var trailer = Encoding.ASCII.GetString(bytes, Math.Max(0, bytes.Length - 2048), Math.Min(2048, bytes.Length)).TrimEnd();
        return trailer.Contains("startxref") && trailer.EndsWith("%%EOF", StringComparison.Ordinal);
    }
}
