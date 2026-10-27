using System;
using System.Collections.Generic;

namespace Lamma.Core
{
    /// <summary>
    /// Minimal service registry so screens can resolve services without singletons
    /// scattered everywhere. Registered once in Bootstrap.
    /// </summary>
    public static class ServiceLocator
    {
        private static readonly Dictionary<Type, object> _services = new();

        public static void Register<T>(T service) where T : class
            => _services[typeof(T)] = service;

        public static T Get<T>() where T : class
        {
            if (_services.TryGetValue(typeof(T), out var s)) return (T)s;
            throw new InvalidOperationException($"Service {typeof(T).Name} not registered.");
        }

        public static bool TryGet<T>(out T service) where T : class
        {
            if (_services.TryGetValue(typeof(T), out var s)) { service = (T)s; return true; }
            service = null; return false;
        }

        public static void Clear() => _services.Clear();
    }
}
