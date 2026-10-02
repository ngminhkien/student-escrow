using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;

namespace StudentEscrow.API.Common;

public sealed class DevelopmentKeyRepository : IXmlRepository
{
    private readonly List<XElement> elements = [];
    private readonly object sync = new();

    public IReadOnlyCollection<XElement> GetAllElements()
    {
        lock (sync)
        {
            return elements.Select(element => new XElement(element)).ToArray();
        }
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        lock (sync)
        {
            elements.Add(new XElement(element));
        }
    }
}
