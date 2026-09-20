> Imported material source: `Doc/TOPSTX API Reference.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `TOPSTX API Reference`.

# TOPSTX API Reference

## 3. Attribute

### 3.1. TOPSTX C API

This section describes the TOPSTX c api.

```cpp
void topstxInitialize(void *resver)
```

Force initialization (optional)

Force TOPSTX library to initialize. The first call to any TOPSTX API function will automatically initialize the entire API. This can make the first call much slower than subsequent calls. In applications where the first call to TOPSTX may be in a performance-critical section, calling topstxInitialize before any performance-critical sections will ensure TOPSTX initialization occurs at an acceptable time. Since topstxInitialize takes no parameters and has no expected behavior besides initialization, it is convenient to add a call to topstxInitialize in TOPSTX-instrumented applications that need to force earlier initialization without changing any other code. For example, if an app's first TOPSTX call is topstxDomainCreate, and it is difficult to move that call earlier because the domain handle must be stored in an object only created at that point, adding a call to topstxInitialize at the top of main() will ensure the later call to topstxDomainCreate is as fast as possible.

**Parameters:** **reserved** -- must be zero or NULL.

```cpp
void topstxDomainMark(topstxDomainHandle_t domain, const topstxEventAttributes_t *eventAttrib)
```

Marks an instantaneous event in the application.

A marker can contain a text message or specify additional information using the event attributes structure. These attributes include a text message, color, category, and a payload. Each of the attributes is optional and can only be sent out using the topstxDomainMark function.

topstxDomainMark(NULL, event) is equivalent to calling topstxMark(event).

**See also:**

topstxMark

**Parameters:**

- **domain** -- The domain of scoping the category.
- **eventAttrib** -- The event attribute structure defining the marker's attribute types and attribute values.

```cpp
void topstxMark(const topstxEventAttributes_t *eventAttrib)
```

Marks an instantaneous event in the application.

A marker can contain a text message or specify additional information using the event attributes structure. These attributes include a text message, color, category, and a payload. Each of the attributes is optional and can only be sent out using the topstxMark function. If topstxMark are used to specify the marker or if an attribute is unspecified then a default value will be used.

**See also:**

topstxDomainMark

**Example:**

```
// zero the structure
topstxEventAttributes_t eventAttrib = {0};
// set the version and the size information
eventAttrib.version = TOPSTX_VERSION;
eventAttrib.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
// configure the attributes.  0 is the default for all attributes.
eventAttrib.colorType = TOPSTX_COLOR_RGB;
eventAttrib.color = 0x880000;
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_STRING;
eventAttrib.message.str = "Example topstxMark";
topstxMark(&eventAttrib);
```

**Parameters:** **eventAttrib** -- The event attribute structure defining the marker's attribute types and attribute values.

```cpp
topstxRangeId_t topstxDomainRangeStart(topstxDomainHandle_t domain, const topstxEventAttributes_t *eventAttrib)
```

Starts a process range in a domain.

**Remark:**

Ranges defined by Start/End can overlap.

**See also:**

topstxDomainRangeEnd

**Example:**

```
topstxDomainHandle_t domain = topstxDomainCreate("my domain");
topstxEventAttributes_t eventAttrib = {0};
eventAttrib.version = TOPSTX_VERSION;
eventAttrib.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_STRING;
eventAttrib.message.str = "my range";
topstxRangeId_t rangeId = topstxDomainRangeStart(domain, &eventAttrib);
// ...
topstxDomainRangeEnd(domain, rangeId);
```

**Parameters:**

- **domain** -- The domain of scoping the category.
- **eventAttrib** -- The event attribute structure defining the range's attribute types and attribute values.

**Returns:** The unique ID used to correlate a pair of Start and End events.

```cpp
topstxRangeId_t topstxRangeStart(const topstxEventAttributes_t *eventAttrib)
```

Starts a process range.

**Remark:**

Ranges defined by Start/End can overlap.

**See also:**

topstxRangeEnd topstxDomainRangeStart

**Example:**

```
topstxEventAttributes_t eventAttrib = {0};
eventAttrib.version = TOPSTX_VERSION;
eventAttrib.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
eventAttrib.category = 3;
eventAttrib.colorType = TOPSTX_COLOR_RGB;
eventAttrib.color = 0x0088FF;
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_STRING;
eventAttrib.message.str = "Example Range";
topstxRangeId_t rangeId = topstxRangeStart(&eventAttrib);
// ...
topstxRangeEnd(rangeId);
```

**Parameters:** **eventAttrib** -- The event attribute structure defining the range's attribute types and attribute values.

**Returns:** The unique ID used to correlate a pair of Start and End events.

```cpp
void topstxDomainRangeEnd(topstxDomainHandle_t domain, topstxRangeId_t id)
```

Ends a process range.

**Remark:**

This function is offered for completeness but is an alias for topstxRangeEnd. It does not need a domain parameter since that is associated with the range ID at topstxDomainRangeStart.

**See also:**

topstxDomainRangeStart

**Example:**

```
topstxDomainHandle_t domain = topstxDomainCreate("my domain");
topstxEventAttributes_t eventAttrib = {0};
eventAttrib.version = TOPSTX_VERSION;
eventAttrib.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_STRING;
eventAttrib.message.str = "my range";
topstxRangeId_t rangeId = topstxDomainRangeStart(domain, &eventAttrib);
// ...
topstxDomainRangeEnd(domain, rangeId);
```

**Parameters:**

- **domain** -- The domain
- **id** -- The correlation ID returned from a topstxRangeStart call.

```cpp
void topstxRangeEnd(topstxRangeId_t id)
```

Ends a process range.

**See also:**

topstxDomainRangeStart topstxRangeStart

**Parameters:** **id** -- The correlation ID returned from a topstxRangeStart call.

```cpp
void topstxDomainRangePush(topstxDomainHandle_t domain, const topstxEventAttributes_t *eventAttrib)
```

Starts a nested thread range.

**See also:**

topstxDomainRangePop

**Example:**

```
topstxDomainHandle_t domain = topstxDomainCreate("example domain");
topstxEventAttributes_t eventAttrib = {0};
eventAttrib.version = TOPSTX_VERSION;
eventAttrib.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
eventAttrib.colorType = TOPSTX_COLOR_RGB;
eventAttrib.color = 0xFF0000;
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_STRING;
eventAttrib.message.str = "Level 0";
topstxDomainRangePush(domain, &eventAttrib);

// Re-use eventAttrib
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_UNICODE;
eventAttrib.message.unicode = L"Level 1";
topstxDomainRangePush(domain, &eventAttrib);

topstxDomainRangePop(domain); //level 1
topstxDomainRangePop(domain); //level 0
```

**Parameters:**

- **domain** -- The domain of scoping.
- **eventAttrib** -- The event attribute structure defining the range's attribute types and attribute values.

```cpp
void topstxRangePush(const topstxEventAttributes_t *eventAttrib)
```

Starts a nested thread range.

**See also:**

topstxDomainRangePush topstxRangePop

**Example:**

```
topstxEventAttributes_t eventAttrib = {0};
eventAttrib.version = TOPSTX_VERSION;
eventAttrib.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
eventAttrib.colorType = TOPSTX_COLOR_RGB;
eventAttrib.color = 0xFF0000;
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_STRING;
eventAttrib.message.str = "Level 0";
topstxRangePush(&eventAttrib);

// Re-use eventAttrib
eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_UNICODE;
eventAttrib.message.unicode = L"Level 1";
topstxRangePush(&eventAttrib);

topstxRangePop();
topstxRangePop();
```

**Parameters:** **eventAttrib** -- The event attribute structure defining the range's attribute types and attribute values.

```cpp
void topstxDomainRangePop(topstxDomainHandle_t domain)
```

Ends a nested thread range.

**See also:**

topstxRangePush

**Example:**

```
topstxDomainHandle_t domain = topstxDomainCreate("example library");
topstxDomainRangePush(domain, "Level 0");
topstxDomainRangePush(domain, L"Level 1");
topstxDomainRangePop(domain);
topstxDomainRangePop(domain);
```

**Parameters:** **domain** -- The domain of scoping.

```cpp
void topstxRangePop()
```

Ends a nested thread range.

**See also:**

topstxRangePush

**Example:**

```
topstxRangePush("Level 0");
topstxRangePush(L"Level 1");
topstxRangePop();
topstxRangePop();
```

```cpp
void topstxDomainNameCategory(topstxDomainHandle_t domain, uint32_t category, const char *name)
```

Annotate a TOPSTX category used within a domain.

Categories are used to group sets of events. Each category is identified through a unique ID and that ID is passed into any of the marker/range events to assign that event to a specific category. The topstxDomainNameCategory function calls allow the user to assign a name to a category ID that is specific to the domain.

topstxDomainNameCategory(NULL, category, name) is equivalent to calling topstxNameCategory(category, name).

**Remark:**

The category names are tracked per domain.

**Example:**

```
topstxDomainHandle_t domain = topstxDomainCreate("example");
topstxDomainNameCategory(domain, 1, "Memory Allocation");
topstxDomainNameCategory(domain, 2, L"Memory Transfer");
```

**Parameters:**

- **domain** -- The domain of scoping the category.
- **category** -- The category ID to name.
- **name** -- The name of the category.

```cpp
void topstxNameCategory(uint32_t category, const char *name)
```

Annotate a TOPSTX category.

Categories are used to group sets of events. Each category is identified through a unique ID and that ID is passed into any of the marker/range events to assign that event to a specific category. The topstxNameCategory function calls allow the user to assign a name to a category ID.

**Remark:**

The category names are tracked per process.

**Example:**

```
topstxNameCategory(1, "Memory Allocation");
topstxNameCategory(2, "Memory Transfer");
topstxNameCategory(3, "Memory Object Lifetime");
```

**Parameters:**

- **category** -- The category ID to name.
- **name** -- The name of the category.

```cpp
void topstxNameOsThread(int tid, const char *name)
```

Annotate an OS thread.

Allows the user to name an active thread of the current process. If an invalid thread ID is provided or a thread ID from a different process is used the behavior of the tool is implementation dependent.

Tools expect thread ID to be a number that uniquely identifies the thread at the time of the call. Note that a thread's ID can be reused after it is destroyed. Tools may choose how to handle aliasing of thread IDs.

POSIX pthread_t type returned by pthread_self() may not comply with these expectations. Please use OS-specific thread ID instead of pthread_t.

The thread name is associated to the default domain. To support domains use resource objects via ::topstxDomainResourceCreate.

Android:

```
#include <unistd.h>
topstxNameOsThread(gettid(), "Current thread");
topstxNameOsThread(getpid(), "Main thread");
```

**Examples:**

MS Windows:

```
#include <windows.h>
topstxNameOsThread(GetCurrentThreadId(), "Current thread");
topstxNameOsThread(GetThreadId(SomeThreadHandle), "Other thread");
```

Linux:

```
#include <sys/syscall.h>
topstxNameOsThread(syscall(SYS_gettid), "Current thread");
```

```
#include <unistd.h>
topstxNameOsThread(getpid(), "Main thread");
```

OS X:

```
#include <sys/syscall.h>
topstxNameOsThread(syscall(SYS_thread_selfid), "Current thread");
```

```
#include <pthread.h>
__uint64_t id;
pthread_threadid_np(pthread_self(), &id);
topstxNameOsThread(id, "Current thread");
pthread_threadid_np(somePThreadId, &id);
topstxNameOsThread(id, "Other thread");
```

**Parameters:**

- **threadId** -- The ID of the thread to name.
- **name** -- The name of the thread.

```cpp
void topstxNameDev(int device_id, const char *name)
```

Annotate an Device.

Allows the user to name an device of the current process.

**Examples:**

```
topstxNameDev(1, "Device 1");
```

**Parameters:**

- **device_id** -- The ID of the device to name.
- **name** -- The name of the device.

```cpp
topstxStringHandle_t topstxDomainRegisterString(topstxDomainHandle_t domain, const char *string)
```

Register a string.

Registers an immutable string with TOPSTX. Once registered the pointer used to register the domain name can be used in topstxEventAttributes_t MESSAGE_FIELD. This allows TOPSTX implementation to skip copying the contents of the message on each event invocation.

String registration is an optimization. It is recommended to use string registration if the string will be passed to an event many times.

String are not unregistered, except that by unregistering the entire domain

**Example:**

```
  topstxDomainCreate("com.enflame.topstx.example");
  topstxStringHandle_t message = topstxDomainRegisterStringA(domain, "registered
string");
  topstxEventAttributes_t eventAttrib = {0};
  eventAttrib.version = TOPSTX_VERSION;
  eventAttrib.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
  eventAttrib.messageType = TOPSTX_MESSAGE_TYPE_REGISTERED;
  eventAttrib.message.registered = message;
```

**Parameters:**

- **domain** -- Domain handle. If NULL then the global domain is used.
- **string** -- A unique pointer to a sequence of characters.

**Returns:** A handle representing the registered string.

```cpp
topstxDomainHandle_t topstxDomainCreate(const char *name)
```

Register a TOPSTX domain.

Domains are used to scope annotations. topstxDomainCreate creates a new named domain.

Each domain maintains its own topstxRangePush and topstxRangePop stack.

**See also:**

topstxDomainDestroy

**Example:**

```
topstxDomainHandle_t domain =
topstxDomainCreate("com.enflame.topstx.example");

topstxMark("topstxMark to global domain");

topstxEventAttributes_t eventAttrib1 = {0};
eventAttrib1.version = TOPSTX_VERSION;
eventAttrib1.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
eventAttrib1.message.str = "topstxDomainMark to global domain";
topstxDomainMark(NULL, &eventAttrib1);

topstxEventAttributes_t eventAttrib2 = {0};
eventAttrib2.version = TOPSTX_VERSION;
eventAttrib2.size = TOPSTX_EVENT_ATTRIB_STRUCT_SIZE;
eventAttrib2.message.str = "topstxDomainMark to
com.enflame.topstx.example"; topstxDomainMark(domain, &eventAttrib2);
topstxDomainDestroy(domain);
```

**Parameters:** **name** -- A unique string representing the domain.

**Returns:** A handle representing the domain.

```cpp
void topstxDomainDestroy(topstxDomainHandle_t domain)
```

Unregister a TOPSTX domain.

Unregisters the domain handle and frees all domain specific resources.

**See also:**

topstxDomainCreate

**Example:**

```
topstxDomainHandle_t domain =
topstxDomainCreate("com.enflame.topstx.example");
topstxDomainDestroy(domain);
```

**Parameters:** **domain** -- the domain handle

```cpp
void topstxSetCorrelationId(uint64_t correlation_id)
```

Set correlation ID for the current ongoing runtime-API.

**Examples:**

```
topstxSetCorrelationId(123);
```

**Parameters:** **correlation_id** -- The correlation ID.

```cpp
int topstxIsEnabled()
```

```cpp
int topstxDomainIsEnabled(topstxDomainHandle_t domain)
```

### 3.2. TOPSTX C++ API

This section describes the TOPSTX c++ api.

```cpp
inline void mark(const Message &message)
```

Marks an instantaneous event in the application.

A marker can contain a text message or specify additional information using the event attributes structure. These attributes include a text message, color, category, and a payload. Each of the attributes is optional and can only be sent out using the topstx::mark function. If topstx::mark are used to specify the marker or if an attribute is unspecified then a default value will be used.

**Parameters:** **message** -- The event attribute structure defining the marker's attribute types and attribute values.

```cpp
inline void mark(const Domain &domain, const Message &message)
```

Marks an instantaneous event in the application.

A marker can contain a text message or specify additional information using the event attributes structure. These attributes include a text message, color, category, and a payload. Each of the attributes is optional and can only be sent out using the topstxDomainMark function.

topstx::domainMark(Domain(), message) is equivalent to calling topstx::mark(message).

**Parameters:**

- **domain** -- The domain of scoping the category.
- **message** -- The event attribute structure defining the marker's attribute types and attribute values.

```cpp
inline topstxRangeId_t rangeStart(const Message &message)
```

Starts a process range.

**Remark:**

Ranges defined by Start/End can overlap.

**Parameters:** **message** -- The event attribute structure defining the range's attribute types and attribute values.

**Returns:** The unique ID used to correlate a pair of Start and End events.

```cpp
inline topstxRangeId_t rangeStart(const Domain &domain, const Message &message)
```

Starts a process range in a domain.

**Remark:**

Ranges defined by Start/End can overlap.

**Parameters:**

- **domain** -- The domain of scoping the category.
- **message** -- The event attribute structure defining the range's attribute types and attribute values.

**Returns:** The unique ID used to correlate a pair of Start and End events.

```cpp
inline void rangeEnd(topstxRangeId_t id)
```

Ends a process range.

**Parameters:** **id** -- The correlation ID returned from a topstx::rangeStart call.

```cpp
inline void rangeEnd(const Domain &domain, topstxRangeId_t id)
```

Ends a process range.

**Parameters:**

- **domain** -- The domain
- **id** -- The correlation ID returned from a topstx::rangeStart call.

```cpp
inline void rangePush(const Message &message)
```

Starts a nested thread range.

**Parameters:** **eventAttrib** -- The event attribute structure defining the range's attribute types and attribute values.

```cpp
inline void rangePush(const Domain &domain, const Message &message)
```

Starts a nested thread range.

**Parameters:**

- **domain** -- The domain of scoping.
- **eventAttrib** -- The event attribute structure defining the range's attribute types and attribute values.

```cpp
inline void rangePop()
```

Ends a nested thread range.

**Returns:** The level of the range being ended. If an error occurs a negative value is returned on the current thread.

```cpp
inline void rangePop(const Domain &domain)
```

Ends a nested thread range.

**Parameters:** **domain** -- The domain of scoping.

```cpp
inline bool isEnabled()
```

```cpp
inline void nameCategory(uint32_t category, const std::string &name)
```

Annotate a TOPSTX category.

Categories are used to group sets of events. Each category is identified through a unique ID and that ID is passed into any of the marker/range events to assign that event to a specific category. The topstxNameCategory function calls allow the user to assign a name to a category ID.

**Remark:**

The category names are tracked per process.

**Parameters:**

- **category** -- The category ID to name.
- **name** -- The name of the category.

```cpp
inline void domainNameCategory(const Domain &domain, uint32_t category, const std::string &name)
```

Annotate a TOPSTX category used within a domain.

Categories are used to group sets of events. Each category is identified through a unique ID and that ID is passed into any of the marker/range events to assign that event to a specific category. The topstxDomainNameCategory function calls allow the user to assign a name to a category ID that is specific to the domain.

topstx::domainNameCategory(Domain(), category, name) is equivalent to calling topstx::nameCategory(category, name).

**Remark:**

The category names are tracked per domain.

**Parameters:**

- **domain** -- The domain of scoping the category.
- **category** -- The category ID to name.
- **name** -- The name of the category.

```cpp
inline void nameOsThread(int threadId, const std::string &name)
```

Annotate an OS thread.

Allows the user to name an active thread of the current process. If an invalid thread ID is provided or a thread ID from a different process is used the behavior of the tool is implementation dependent.

**Parameters:**

- **threadId** -- The ID of the thread to name.
- **name** -- The name of the thread.

```cpp
inline void nameDev(int deviceId, const std::string &name)
```

Annotate an Device.

Allows the user to name an device of the current process.

**Parameters:**

- **deviceId** -- The ID of the device to name.
- **name** -- The name of the device.

```cpp
class Domain
```

*#include <topstx.hpp>*

`domain`s allow for grouping TOPSTX events into a single scope to differentiate them from events in other `domain`s.

By default, all TOPSTX constructs are placed in the "global" TOPSTX domain.

A custom `domain` may be used in order to differentiate a library's or application's TOPSTX events from other events.

`domain`s are expected to be long-lived and unique to a library or application.

Example:

```
// The empty domain means global TOPSTX domain is used
topstx::Domain global_domain;

// Create a custom domain with name "my_domain"
topstx::Domain doman("my_domain");
```

```cpp
class topstx::Payload
```

*#include <topstx.hpp>*

A numerical value that can be associated with a TOPSTX event.

Example:

```
// Constructs a payload from the int32_t value 42
topstx::payload p1(42);

// Constructs a payload from the double value 3.14
topstx::payload p2(3.14);
```

```cpp
union Data
```

#### Public Members

```cpp
uint64_t ullValue
```

```cpp
int64_t llValue
```

```cpp
double dValue
```

```cpp
uint32_t uiValue
```

```cpp
int32_t iValue
```

```cpp
float fValue
```

```cpp
char *stringValue
```

```cpp
char *byteValue
```

```cpp
class Color
```

*#include <topstx.hpp>*

Represents a custom color that can be associated with a TOPSTX event via its `event_attributes`.

Specifying colors for TOPSTX events is a convenient way to visually differentiate among different events in a visualization tool such as Visual Profiler

```cpp
class Message
```

*#include <topstx.hpp>*

Allows associating a message with a TOPSTX event.

Message can specify category,color and payload.

Example:

```
// Creates an `Message` with string "message 0"
topstx::Message message("message 0");

// Creates an `Message` with string "message 1" and color 0xFFAAFF
topstx::Message message("message 1",Color(0xFFAAFF));

// Creates an `Message` with category 9, string "message 1" and color
topstx::Message message(9, "message 1", Color(0xFFAAFF));
```

```cpp
class Tracepoint
```

*#include <topstx.hpp>*

A Tracepoint creating a TOPSTX range to a process within a domain.

Example:

```
topstx::Tracepoint tp;
tp.enter("do something1");
//do something1
tp.reenter("do something2")
//do something2
tp.exit();
```

```cpp
class ScopedRangeStartEnd
```

*#include <topstx.hpp>*

A RAII object for creating a TOPSTX range local to a process within a domain.

When constructed, begins a nested TOPSTX range on the calling thread in the specified domain. Upon destruction, ends the TOPSTX range.

A custom domain can be defined by creating a domain.

Example:

```
// Define a type `my_domain` with a member `name` used to name the domain
// associated with the type `my_domain`.
topstx::Domain domain("my domain");
```

Usage:

```
topstx::ScopedRangeStartEnd r1(domain,"range 1"); // Range in my domain

// Three equivalent ways to make a range in the global domain:
topstx::ScopedRangeStartEnd r2("range 2");
```

```cpp
class ScopedRangePushPop
```

*#include <topstx.hpp>*

A RAII object for creating a TOPSTX range local to a thread within a domain.

When constructed, begins a nested TOPSTX range on the calling thread in the specified domain. Upon destruction, ends the TOPSTX range.

A custom domain can be defined by creating a domain.

Example:

```
// Define a type `my_domain` with a member `name` used to name the domain
// associated with the type `my_domain`.
topstx::Domain domain("my domain");
```

Usage:

```
topstx::ScopedRangePushPop r1(domain,"range 1"); // Range in my domain

// Three equivalent ways to make a range in the global domain:
topstx::ScopedRangePushPop r2("range 2");
```
