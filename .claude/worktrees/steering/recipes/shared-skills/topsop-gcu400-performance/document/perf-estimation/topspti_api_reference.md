> Imported material source: `Doc/TOPSPTI API Reference.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `TOPSPTI API Reference`.

# TOPSPTI API Reference

## 1. Attribute

### 1.1. Activity

Functions, types, and enums that implement the TOPSPTI Activity API.

```cpp
enum Topspti_ActivityFlag
```

Flags associated with activity records.

Activity record flags. Flags can be combined by bitwise OR to associated multiple flags with an activity record. Each flag is specified to a certain activity kind, as noted below.

*Values:*

```cpp
enumerator TOPSPTI_ACTIVITY_FLAG_NONE
```

Indicates the activity record has no flags.

```cpp
enumerator TOPSPTI_ACTIVITY_FLAG_MEMCPY_ASYNC
```

Indicates the activity represents an asynchronous memcpy operation. Valid for TOPSPTI_ACTIVITY_KIND_MEMCPY.

```cpp
enumerator TOPSPTI_ACTIVITY_FLAG_FLUSH_FORCED
```

When calling topsptiActivityFlushAll, this flag can be set to force TOPSPTI to flush all records in the buffer, whether finished or not

```cpp
enumerator TOPSPTI_ACTIVITY_FLAG_MEMSET_ASYNC
```

Indicates the activity represents an asynchronous memset operation. Valid for TOPSPTI_ACTIVITY_KIND_MEMSET.

```cpp
enumerator TOPSPTI_ACTIVITY_FLAG_FORCE_INT
```

```cpp
enum Topspti_ActivityMemoryKind
```

The kinds of memory accessed by a memory operation/copy.

Each kind represents the type of the memory accessed by a memory operation/copy.

*Values:*

```cpp
enumerator TOPSPTI_ACTIVITY_MEMORY_KIND_UNKNOWN
```

The memory kind is unknown.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMORY_KIND_PAGEABLE
```

The memory is pageable.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMORY_KIND_PINNED
```

The memory is pinned.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMORY_KIND_DEVICE
```

The memory is on the device.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMORY_KIND_FORCE_INT
```

```cpp
enum Topspti_ActivityMemcpyKind
```

The kind of a memory copy, indicating the source and destination targets of the copy.

Each kind represents the source and destination targets of a memory copy. Targets are host, device, and array.

*Values:*

```cpp
enumerator TOPSPTI_ACTIVITY_MEMCPY_KIND_UNKNOWN
```

The memory copy kind is not known.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMCPY_KIND_HTOD
```

A host to device memory copy.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMCPY_KIND_DTOH
```

A device to host memory copy.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMCPY_KIND_DTOD
```

A device to device memory copy on the same device.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMCPY_KIND_HTOH
```

A host to host memory copy.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMCPY_KIND_PTOP
```

A peer to peer memory copy across different devices.

```cpp
enumerator TOPSPTI_ACTIVITY_MEMCPY_KIND_FORCE_INT
```

```cpp
enum Topspti_ActivityKind
```

The kinds of activity records.

Each kind of activity record represents an activity occurring on a CPU or GCU. Each kind is associated with an activity record structure that holds information related to that kind.

**See also:**

Topspti_Activity

**See also:**

Topspti_ActivityAPI

**See also:**

Topspti_ActivityMemset

**See also:**

Topspti_ActivityMemcpy

**See also:**

Topspti_ActivityKernel

*Values:*

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_INVALID
```

The activity record is invalid.

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_MEMCPY
```

A host<->host, host<->device, or device<->device memory copy. The corresponding activity record structure is Topspti_ActivityMemcpy.

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_MEMSET
```

A memory set executing on the GCU. The corresponding activity record structure is Topspti_ActivityMemset.

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_KERNEL
```

A kernel executing on the GCU. The corresponding activity record structure is Topspti_ActivityKernel.

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_DRIVER
```

A tops driver API function execution. The corresponding activity record structure is Topspti_ActivityAPI.

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_RUNTIME
```

A tops runtime API function execution. The corresponding activity record structure is Topspti_ActivityAPI.

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_COUNT
```

```cpp
enumerator TOPSPTI_ACTIVITY_KIND_FORCE_INT
```

```cpp
enum Topspti_ActivityThreadIdType
```

Thread-Id types.

TOPSPTI uses different methods to obtain the thread-id depending on the support and the underlying platform. This enum documents these methods for each type. APIs topsptiSetThreadIdType and topsptiGetThreadIdType can be used to set and get the thread-id type.

*Values:*

```cpp
enumerator TOPSPTI_ACTIVITY_THREAD_ID_TYPE_DEFAULT
```

Default type Use POSIX pthread API pthread_self()

```cpp
enumerator TOPSPTI_ACTIVITY_THREAD_ID_TYPE_SYSTEM
```

This type is based on the system API available on the underlying platform and thread-id obtained is supposed to be unique for the process lifetime. Use syscall SYS_gettid

```cpp
enumerator TOPSPTI_ACTIVITY_THREAD_ID_TYPE_SIZE
```

Add new enums before this field.

```cpp
enumerator TOPSPTI_ACTIVITY_THREAD_ID_TYPE_FORCE_INT
```

```cpp
struct PACKED_ALIGNMENT Topspti_Activity_st Topspti_Activity
```

The base activity record.

The activity API uses a Topspti_Activity as a generic representation for any activity. The 'kind' field is used to determine the specified activity kind, and from that the Topspti_Activity object can be cast to the specified activity record type appropriate for that kind.

Note that all activity record types are padded and aligned to ensure that each member of the record is naturally aligned.

**See also:**

Topspti_ActivityKind

```cpp
struct PACKED_ALIGNMENT Topspti_ActivityAPI_st Topspti_ActivityAPI
```

The activity record for a runtime or runtime API invocation.

This activity record represents an invocation of a runtime or driver API (TOPSPTI_ACTIVITY_KIND_RUNTIME and TOPSPTI_ACTIVITY_KIND_DRIVER).

```cpp
struct PACKED_ALIGNMENT Topspti_ActivityMemset_st Topspti_ActivityMemset
```

The activity record for memory sets.

This activity record represents a memory set operation (TOPSPTI_ACTIVITY_KIND_MEMSET).

```cpp
struct PACKED_ALIGNMENT Topspti_ActivityMemcpy_st Topspti_ActivityMemcpy
```

The activity record for memory copies.

This activity record represents a memory copy operation (TOPSPTI_ACTIVITY_KIND_MEMCPY).

```cpp
struct PACKED_ALIGNMENT Topspti_ActivityKernel_st Topspti_ActivityKernel
```

The activity record for kernel.

This activity record represents a kernel execution (TOPSPTI_ACTIVITY_KIND_KERNEL)

```cpp
typedef void(*Topspti_BuffersCallbackRequestFunc)(uint8_t **buffer, size_t *size, size_t *maxNumRecords)
```

Function type for callback used by TOPSPTI to request an empty buffer for storing activity records.

This callback function signals the TOPSPTI client that an activity buffer is needed by TOPSPTI. The activity buffer would be used by TOPSPTI to store activity records. The callback function can decline the request by setting `*buffer` to empty pointer. In this case TOPSPTI may drop activity records.

**Parameters:**

- **buffer** -- Returns the new buffer. If set to empty pointer then no buffer is returned.
- **size** -- Returns the size of the returned buffer.
- **maxNumRecords** -- There is currently no actual effect. Reserved for returning the maximum number of records that should be placed in the buffer. If set to zero, the buffer is filled with as many records as possible. If greater than zero, the buffer is filled with at most `maxNumRecords` records before it is returned.

```cpp
typedef void(*Topspti_BuffersCallbackCompleteFunc)(uint8_t *buffer, size_t size, size_t validSize)
```

Function type for callback used by TOPSPTI to deliver buffers of activity records.

This callback function deliver to the TOPSPTI client a buffer containing activity records. The buffer contains `validSize` bytes of activity records which can be read by topsptiActivityGetNextRecord. The number of dropped records can be read by topsptiActivityGetNumDroppedRecords. TOPSPTI relinquished ownership of the buffer and will not use it anymore after this call. Client can deliver the buffer to TOPSPTI once more by the Topspti_BuffersCallbackRequestFunc callback.

**Parameters:**

- **buffer** -- Activity record buffer.
- **size** -- The total size of the buffer in bytes as set in Topspti_BuffersCallbackRequestFunc.
- **validSize** -- The size of valid bytes in the buffer.

```cpp
typedef uint64_t(*Topspti_TimestampCallbackFunc)(void)
```

Callback function type for timestamp generation in TOPSPTI.

This callback function would be triggered when the TOPSPTI client need obtain a timestamp. The generated timestamp will serve as a normalized reference time for activity tracking within TOPSPTI, including but not limited to marking event start/end times in activity records. The function should return a timestamp in nanoseconds.

**See also:**

topsptiActivityRegisterTimestampCallback

```cpp
TopsptiResult topsptiActivityEnable(Topspti_ActivityKind kind)
```

Enable collection of a specified kind of activity record.

Enable collection of a specified kind of activity record. We can calling this function multiple times to enable multiple kinds. All activity kinds are disabled for collection by default.

**Parameters:** **kind** -- The kind of activity record to enable collection

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_NOT_INITIALIZED** --
- **TOPSPTI_ERROR_NOT_COMPATIBLE** -- if the activity kind can not be enabled
- **TOPSPTI_ERROR_INVALID_KIND** -- if the activity kind is not supported

```cpp
TopsptiResult topsptiActivityDisable(Topspti_ActivityKind kind)
```

Disable collection of a specified kind of activity record.

Disable collection of a specified kind of activity record. We can calling this function multiple times to disable multiple kinds. All activity kinds are disabled for collection by default.

**Parameters:** **kind** -- The kind of activity record to disable collection

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_NOT_INITIALIZED** --
- **TOPSPTI_ERROR_INVALID_KIND** -- if the activity kind is not supported

```cpp
TopsptiResult topsptiActivityGetNextRecord(uint8_t *buffer, size_t validBufferSizeBytes, Topspti_Activity **record)
```

Iterate over the activity records in a buffer.

This is a helper function to iterate over the activity records in a buffer. A buffer of activity records is typically obtained by receiving a Topspti_BuffersCallbackCompleteFunc callback.

An example of typical usage:

```
Topspti_Activity *record = NULL;
TopsptiResult status = TOPSPTI_SUCCESS;
  do {
     status = topsptiActivityGetNextRecord(buffer, validSize, &record);
     if(status == TOPSPTI_SUCCESS) {
          // Use record here...
     }
     else if (status == TOPSPTI_ERROR_MAX_LIMIT_REACHED)
         break;
     else {
         goto Error;
     }
   } while (1);
```

**Parameters:**

- **buffer** -- Buffer containing activity records
- **record** -- Inputs the previous activity record returned by topsptiActivityGetNextRecord and returns the next activity record from the buffer. If input empty pointer, returns the first activity record in the buffer. If one or more timestamps are not collected, records would contain invalid timestamps, which is zero.
- **validBufferSizeBytes** -- Number of valid bytes in the buffer.

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_NOT_INITIALIZED** --
- **TOPSPTI_ERROR_MAX_LIMIT_REACHED** -- if no more records in the buffer
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `buffer` or `record` is empty pointer

```cpp
TopsptiResult topsptiActivityRegisterCallbacks(Topspti_BuffersCallbackRequestFunc funcBufferRequested, Topspti_BuffersCallbackCompleteFunc funcBufferCompleted)
```

Registers callback functions with TOPSPTI for activity buffer handling.

This function registers two callback functions, to be used in asynchronous buffer handling. If registered, activity record buffers are handled using asynchronous requested and completed callbacks from TOPSPTI.

Registering the two callbacks prevents the client from using TOPSPTI's blocking enqueue or dequeue functions.

**Parameters:**

- **funcBufferRequested** -- Callback which is invoked when an empty buffer is requested by TOPSPTI
- **funcBufferCompleted** -- Callback which is invoked when a buffer containing activity records is delivered from TOPSPTI

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if either `funcBufferRequested` or `funcBufferCompleted` is empty pointer

```cpp
TopsptiResult topsptiActivityFlushAll(uint32_t flag)
```

Request to deliver activity records via the buffer completion callback.

Using the callback registered in topsptiActivityRegisterCallbacks, this function returns all activity records to the TOPSPTI client.

This is a blocking call, but it doesn't issue any tops synchronization calls implicitly, so it's not guaranteed that all activities are completed on the underlying devices. If it has all the information filled up, including the timestamps if any, activity record is considered as completed. If all activity records with complete information are expected to be delivered, it is the client's responsibility to issue necessary tops synchronization calls before calling this function.

Behavior of the function based on the input flag: (-) ::For default flush (when flag is TOPSPTI_ACTIVITY_FLAG_NONE), it returns all the activity buffers which have all the activity records completed (but buffers need not to be full though). It doesn't return buffers which have incomplete records. If needed, default flush can be done at a regular interval in a separate thread. (-) ::For forced flush (when flag is TOPSPTI_ACTIVITY_FLAG_FLUSH_FORCED), it returns all the activity buffers including the buffers which have incomplete activity records. It's suggested for clients to do the force flush before the termination of the profiling session to allow remaining buffers to be delivered. In general, it can be done in the at-exit handler.

Before calling this function, the buffer completion callback api should be activated by calling topsptiActivityRegisterCallbacks.

**See also:**

topsptiActivityFlushPeriod

**Parameters:** **flag** -- The flag can be set to indicate a forced flush. See Topspti_ActivityFlag

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_NOT_INITIALIZED** --
- **TOPSPTI_ERROR_INVALID_OPERATION** -- if not preceded by a successful call to topsptiActivityRegisterCallbacks
- **TOPSPTI_ERROR_UNKNOWN** -- an internal error occurred

```cpp
TopsptiResult topsptiFinalize()
```

Detach TOPSPTI from the running process.

This API detaches the TOPSPTI from the running process. It destroys and cleans up all the resources associated with TOPSPTI in the current process. After TOPSPTI detaches from the process, the process will keep on running with no TOPSPTI attached to it. For safe operation of the API, TOPSPTI client needs to make sure that required TOPS synchronization and TOPSPTI activity buffer flush is done before calling the API.

```cpp
TopsptiResult topsptiActivityFlushPeriod(uint32_t time)
```

Sets the flush period for the worker thread.

TOPSPTI creates a worker thread to minimize the perturbance for the application created threads. TOPSPTI offloads certain operations from the application threads to the worker thread, this includes synchronization of profiling resources between host and device, delivery of the activity buffers to the client using the callback registered in topsptiActivityRegisterCallbacks. For performance reasons, TOPSPTI wakes up the worker thread based on certain heuristics.

This API is used to control the flush period of the worker thread. This setting will override the TOPSPTI heuristics. Setting time to zero disables the periodic flush and restores the default behavior.

Periodic flush can return only those activity buffers which are full and have all the activity records completed.

It's allowed to use the API topsptiActivityFlushAll to flush the data on-demand, even when client sets the periodic flush.

**See also:**

topsptiActivityFlushAll

**Parameters:** **time** -- flush period in milliseconds (ms)

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_NOT_INITIALIZED** --

```cpp
TopsptiResult topsptiSetThreadIdType(Topspti_ActivityThreadIdType type)
```

Set the thread-id type.

TOPSPTI uses the method corresponding to set type to generate the thread-id. See enum Topspti_ActivityThreadIdType for the list of methods. Activity records having thread-id field contain the same value. Thread id type must not be changed during the profiling session to avoid thread-id value mismatch across activity records.

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_NOT_SUPPORTED** -- if `type` is not supported on the platform

```cpp
TopsptiResult topsptiGetThreadIdType(Topspti_ActivityThreadIdType *type)
```

Get the thread-id type.

Returns the thread-id type used in TOPSPTI

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `type` is empty pointer

```cpp
TopsptiResult topsptiGetTimestamp(uint64_t *timestamp)
```

Get the TOPSPTI timestamp.

Returns a timestamp normalized to correspond with the start and end timestamps reported in the TOPSPTI activity records. The timestamp is reported in nanoseconds.

**Parameters:** **timestamp** -- Returns the TOPSPTI timestamp

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `timestamp` is empty pointer

```cpp
TopsptiResult topsptiGetLastError()
```

Returns the last error from a topspti call or callback.

Returns the last error that has been produced by any of the topspti api calls or the callback in the same host thread and resets it to TOPSPTI_SUCCESS.

```cpp
TopsptiResult topsptiActivityGetNumDroppedRecords(size_t *dropped)
```

Get the number of activity records that were dropped of insufficient buffer space.

Get the number of records that were dropped because of insufficient buffer space. The dropped count includes records that could not be recorded because TOPSPTI did not have activity buffer space available for the record (because the Topspti_BuffersCallbackRequestFunc callback did not return an empty buffer of sufficient size). The dropped count maintained for the queue is reset to zero when this function is called.

**Parameters:** **dropped** -- The number of records that were dropped since the last call to this function.

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_NOT_INITIALIZED** --
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `dropped` is empty pointer

```cpp
TopsptiResult topsptiActivityRegisterTimestampCallback(Topspti_TimestampCallbackFunc funcTimestamp)
```

Registers callback function with TOPSPTI for providing timestamp.

TOPSPTI allows user registers a callback function to providing timestamp instead of using it's default method. By default TOPSPTI uses clock_gettime(CLOCK_REALTIME, ..) to retrieve the timestamp.

To make sure all records report the timestamp using the callback function registered through topsptiActivityRegisterTimestampCallback API, user should done registration of timestamp callback before any of the TOPSPTI activity kinds are enabled. Otherwise, part of timestamps may be missing or be report through previous method.

**Parameters:** **funcTimestamp** -- Callback function which is invoked by TOPSPTI when it need a timestamp.

**Returns:**

- **TOPSPTI_SUCCESS** --
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `funcTimestamp` is NULL
- **TOPSPTI_ERROR_NOT_INITIALIZED** --

```cpp
struct Topspti_Activity_st
```

*#include <topspti_activity.h>*

The base activity record.

The activity API uses a Topspti_Activity as a generic representation for any activity. The 'kind' field is used to determine the specified activity kind, and from that the Topspti_Activity object can be cast to the specified activity record type appropriate for that kind.

Note that all activity record types are padded and aligned to ensure that each member of the record is naturally aligned.

**See also:**

Topspti_ActivityKind

#### Public Members

```cpp
Topspti_ActivityKind kind
```

The kind of this activity.

```cpp
struct Topspti_ActivityAPI_st
```

*#include <topspti_activity.h>*

The activity record for a runtime or runtime API invocation.

This activity record represents an invocation of a runtime or driver API (TOPSPTI_ACTIVITY_KIND_RUNTIME and TOPSPTI_ACTIVITY_KIND_DRIVER).

#### Public Members

```cpp
Topspti_ActivityKind kind
```

The activity record kind, must be TOPSPTI_ACTIVITY_KIND_DRIVER or TOPSPTI_ACTIVITY_KIND_RUNTIME.

```cpp
Topspti_CallbackId cbid
```

The ID of the driver or runtime function.

```cpp
uint64_t start
```

The start timestamp for the function, in ns. A value of zero indicates that the start time is unknown.

```cpp
uint64_t end
```

The end timestamp for the function, in ns. A value of zero indicates that the end time is unknown.

```cpp
uint32_t processId
```

ID of the process where the driver or runtime tops function is executing.

```cpp
uint32_t threadId
```

ID of the thread where the driver or runtime tops function is executing.

```cpp
uint32_t correlationId
```

Correlation ID of the driver or runtime tops function. Each function invocation is assigned a unique correlation ID, which is equal to the correlation ID in the memcpy, memset, or kernel activity record that is associated with this function.

```cpp
uint32_t returnValue
```

The return value for the function. For a tops driver function with will be zero, and for a tops runtime function this will be a topsError_t value.

```cpp
struct Topspti_ActivityMemset_st
```

*#include <topspti_activity.h>*

The activity record for memory sets.

This activity record represents a memory set operation (TOPSPTI_ACTIVITY_KIND_MEMSET).

#### Public Members

```cpp
Topspti_ActivityKind kind
```

Activity record kind, which is must be TOPSPTI_ACTIVITY_KIND_MEMSET.

```cpp
uint32_t value
```

Value being assigned to memory by the memset.

```cpp
uint64_t bytes
```

Number of bytes being set by the memset.

```cpp
uint64_t start
```

The start timestamp for the memset, in ns. A value of zero indicates that the start time is unknown.

```cpp
uint64_t end
```

The end timestamp for the memset, in ns. A value of zero indicates that the end time is unknown.

```cpp
uint32_t deviceId
```

ID of the device where the memset is occurring.

```cpp
uint32_t contextId
```

ID of the context where the memset is occurring.

```cpp
uint32_t streamId
```

ID of the stream where the memset is occurring.

```cpp
uint32_t correlationId
```

Correlation ID of the memset. Each memset is assigned a unique correlation ID, which is equal to the correlation ID in the runtime or driver API activity record that launched the memset.

```cpp
uint16_t flags
```

Flags associated with the memset.

**See also:**

Topspti_ActivityFlag

```cpp
uint16_t memoryKind
```

Memory kind of the memset

**See also:**

Topspti_ActivityMemoryKind

```cpp
uint32_t pad
```

Undefined, reserved for internal use.

```cpp
void *reserved0
```

Undefined, reserved for internal use.

```cpp
struct Topspti_ActivityMemcpy_st
```

*#include <topspti_activity.h>*

The activity record for memory copies.

This activity record represents a memory copy operation (TOPSPTI_ACTIVITY_KIND_MEMCPY).

#### Public Members

```cpp
Topspti_ActivityKind kind
```

Activity record kind, which is must be TOPSPTI_ACTIVITY_KIND_MEMCPY.

```cpp
uint8_t copyKind
```

Kind of the memcpy, stored as a byte to reduce record size.

**See also:**

Topspti_ActivityMemcpyKind

```cpp
uint8_t srcKind
```

The source memory kind read by the memcpy, stored as a byte to reduce record size.

**See also:**

Topspti_ActivityMemoryKind

```cpp
uint8_t dstKind
```

The destination memory kind read by the memcpy, stored as a byte to reduce record size.

**See also:**

Topspti_ActivityMemoryKind

```cpp
uint8_t flags
```

Flags associated with the memcpy.

**See also:**

Topspti_ActivityFlag

```cpp
uint64_t bytes
```

Number of bytes transferred by the memcpy.

```cpp
uint64_t start
```

The start timestamp for the memcpy, in ns. A value of zero indicates that the start time is unknown.

```cpp
uint64_t end
```

The end timestamp for the memcpy, in ns. A value of zero indicates that the end time is unknown.

```cpp
uint32_t deviceId
```

ID of the device where the memcpy is occurring.

```cpp
uint32_t contextId
```

ID of the context where the memcpy is occurring.

```cpp
uint32_t streamId
```

ID of the stream where the memcpy is occurring.

```cpp
uint32_t correlationId
```

Correlation ID of the memcpy. Each memcpy is assigned a unique correlation ID, which is equal to the correlation ID in the runtime or driver API activity record that launched the memcpy.

```cpp
uint32_t reservedId
```

Undefined, reserved for internal use.

```cpp
uint32_t pad
```

Undefined, reserved for internal use.

```cpp
void *reserved0
```

Undefined, reserved for internal use.

```cpp
struct Topspti_ActivityKernel_st
```

*#include <topspti_activity.h>*

The activity record for kernel.

This activity record represents a kernel execution (TOPSPTI_ACTIVITY_KIND_KERNEL)

#### Public Members

```cpp
Topspti_ActivityKind kind
```

The activity record kind, which is must be TOPSPTI_ACTIVITY_KIND_KERNEL.

```cpp
uint32_t reservedSpace0
```

Undefined. Reserved for internal use.

```cpp
uint64_t start
```

The start timestamp for the kernel execution, in ns. A value of zero indicates that the start time is unknown.

```cpp
uint64_t end
```

The end timestamp for the kernel execution, in ns. A value of zero indicates that the end time is unknown.

```cpp
uint64_t completed
```

The completed timestamp for the kernel execution, in ns. It represents the completion of the kernel itself and all it's child kernels. A value of zero indicates that the completion time is unknown.

```cpp
uint32_t deviceId
```

ID of the device where the kernel is executing.

```cpp
uint32_t contextId
```

ID of the context where the kernel is executing.

```cpp
uint32_t streamId
```

ID of the stream where the kernel is executing.

```cpp
uint32_t correlationId
```

Correlation ID of the kernel. Each kernel execution is assigned a unique correlation ID, which is equal to the correlation ID in the runtime or driver API activity record that launched the kernel.

```cpp
int32_t gridX
```

X-dimension grid size for the kernel.

```cpp
int32_t gridY
```

Y-dimension grid size for the kernel.

```cpp
int32_t gridZ
```

Z-dimension grid size for the kernel.

```cpp
int32_t blockX
```

X-dimension block size for the kernel.

```cpp
int32_t blockY
```

Y-dimension block size for the kernel.

```cpp
int32_t blockZ
```

Z-dimension grid size for the kernel.

```cpp
int64_t gridId
```

The grid ID of the kernel. Each kernel is assigned a unique grid ID at runtime.

```cpp
const char *name
```

The name of the kernel. This name is shared across all activity records representing the same kernel, and so should not be modified.

```cpp
void *reserved0
```

Undefined. Reserved for internal use.

### 1.2. Callback

Functions, types, and enums that implement the TOPSPTI Callback API.

```cpp
enum Topspti_ApiCallbackSite
```

Specifies the point in an API call that a callback is issued.

Specifies the point in an API call that a callback is issued. This value is communicated to the callback function via Topspti_CallbackData::callbackSite.

*Values:*

```cpp
enumerator TOPSPTI_API_ENTER
```

The callback is at the entry of the API call.

```cpp
enumerator TOPSPTI_API_EXIT
```

The callback is at the exit of the API call.

```cpp
enumerator TOPSPTI_API_CBSITE_FORCE_INT
```

```cpp
enum Topspti_CallbackDomain
```

Callback domains.

Callback domains. Each domain represents callback points for a group of related API functions or tops driver activity.

*Values:*

```cpp
enumerator TOPSPTI_CB_DOMAIN_INVALID
```

Invalid domain.

```cpp
enumerator TOPSPTI_CB_DOMAIN_DRIVER_API
```

Domain containing callback points for all driver API functions.

```cpp
enumerator TOPSPTI_CB_DOMAIN_RUNTIME_API
```

Domain containing callback points for all runtime API functions.

```cpp
enumerator TOPSPTI_CB_DOMAIN_SIZE
```

```cpp
enumerator TOPSPTI_CB_DOMAIN_FORCE_INT
```

```cpp
typedef uint32_t Topspti_CallbackId
```

An ID for a driver API or runtime API.

An ID for a driver API or runtime API. Within a driver API callback this should be interpreted as a Topspti_driver_api_trace_cbid value (these values are defined in topspti_driver_cbid.h). Within a runtime API callback this should be interpreted as a Topspti_runtime_api_trace_cbid value (these values are defined in topspti_runtime_cbid.h).

```cpp
typedef void(*Topspti_CallbackFunc)(void *userdata, Topspti_CallbackDomain domain, Topspti_CallbackId cbid, const void *cbdata)
```

Function type for a callback.

Function type for a callback. The type of the data passed to the callback in `cbdata` depends on the `domain`. If `domain` is TOPSPTI_CB_DOMAIN_DRIVER_API or TOPSPTI_CB_DOMAIN_RUNTIME_API the type of `cbdata` will be Topspti_CallbackData.

**Parameters:**

- **userdata** -- User data supplied at subscription of the callback
- **domain** -- The domain of the callback
- **cbid** -- The ID of the callback
- **cbdata** -- Data passed to the callback.

```cpp
typedef struct Topspti_Subscriber_st *Topspti_SubscriberHandle
```

A callback subscriber.

```cpp
const typedef Topspti_CallbackDomain *Topspti_DomainTable
```

Pointer to an array of callback domains.

```cpp
TopsptiResult topsptiSupportedDomains(size_t *domainCount, Topspti_DomainTable *domainTable)
```

Get available callback domains.

Returns in `*domainTable` an array of size `*domainCount` of all the available callback domains.

**Note:**

**Thread-safety**: This function is thread safe.

**Parameters:**

- **domainCount** -- Return the number of callback domains
- **domainTable** -- Return a pointer to an array of available callback domains

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `domainCount` or `domainTable` are NULL

```cpp
TopsptiResult topsptiSubscribe(Topspti_SubscriberHandle *subscriber, Topspti_CallbackFunc callback, void *userdata)
```

Register a callback subscriber with a callback function and user data.

Register a callback subscriber with a callback function and a pointer to user data or empty. The returned subscriber handle can be used to enable or disable the callback for specified domains and callback IDs.

**Note:**

Only one subscriber can be registered status at same time point. It's the responsibility of all the TOPSPTI clients to call this function before starting the profiling session, to ensure that no other TOPSPTI client interrupts the profiling session. This function would return the error code TOPSPTI_ERROR_MULTIPLE_SUBSCRIBERS_NOT_SUPPORTED, if another TOPSPTI client has already started a profiling session.

**Note:**

This function does not enable any callbacks.

**Note:**

**Thread-safety**: This function is thread safe.

**Parameters:**

- **subscriber** -- Returns handle to registered subscriber
- **callback** -- The callback function
- **userdata** -- A pointer to user data or empty. This data will be passed to the callback function via the `userdata` parameter.

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_MULTIPLE_SUBSCRIBERS_NOT_SUPPORTED** -- if there is already a TOPSPTI subscriber registered
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `subscriber` is NULL

```cpp
TopsptiResult topsptiUnsubscribe(Topspti_SubscriberHandle subscriber)
```

Unregister a callback subscriber by handle.

Removes a callback subscriber so that no future callbacks will be issued to that subscriber.

**Note:**

**Thread-safety**: This function is thread safe.

**Parameters:** **subscriber** -- Handle to the registered subscriber

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `subscriber` is NULL

```cpp
TopsptiResult topsptiGetCallbackState(uint32_t *enable, Topspti_SubscriberHandle subscriber, Topspti_CallbackDomain domain, Topspti_CallbackId cbid)
```

Get the current enabled/disabled state of a callback for a specified domain and function ID.

If the callback for a domain and callback ID is enabled, this function would return non-zero in `*enable` , else return zero.

**Note:**

**Thread-safety**: A subscriber must serialize access to topsptiGetCallbackState, topsptiEnableCallback, topsptiEnableDomain, and topsptiEnableAllDomains.

**Parameters:**

- **enable** -- Non-zero if callback enabled, else zero.
- **subscriber** -- Handle to the registered subscriber
- **domain** -- The domain of the callback
- **cbid** -- The ID of the callback

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `enabled` is NULL, or if `subscriber`, `domain` or `cbid` is unavailable.

```cpp
TopsptiResult topsptiEnableCallback(uint32_t enable, Topspti_SubscriberHandle subscriber, Topspti_CallbackDomain domain, Topspti_CallbackId cbid)
```

Enable or disabled callbacks for a specified domain and callback ID.

Enable or disabled callbacks for a subscriber for a specified domain and callback ID.

**Note:**

**Thread-safety**: A subscriber must serialize access to topsptiGetCallbackState, topsptiEnableCallback, topsptiEnableDomain, and topsptiEnableAllDomains.

**Parameters:**

- **enable** -- New enable state for the callback. We set it as zero to disable the callback, else to enable the callback.
- **subscriber** -- Handle for callback subscription
- **domain** -- The domain of the callback
- **cbid** -- The ID of the callback

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `subscriber`, `domain` or `cbid` is unavailable.

```cpp
TopsptiResult topsptiEnableDomain(uint32_t enable, Topspti_SubscriberHandle subscriber, Topspti_CallbackDomain domain)
```

Enable or disable all callbacks for a specified domain.

Enable or disable all callbacks for a specified domain.

**Note:**

**Thread-safety**: A subscriber must serialize access to topsptiGetCallbackState, topsptiEnableCallback, topsptiEnableDomain, and topsptiEnableAllDomains.

**Parameters:**

- **enable** -- New enable state for all callbacks in the domain. We set it as zero to disable all callbacks, else to enable all callbacks.
- **subscriber** -- Handle for callback subscription
- **domain** -- The domain of the callback

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `subscriber` or `domain` is unavailable

```cpp
TopsptiResult topsptiEnableAllDomains(uint32_t enable, Topspti_SubscriberHandle subscriber)
```

Enable or disable all callbacks in all domains.

Enable or disable all callbacks in all domains.

**Note:**

**Thread-safety**: A subscriber must serialize access to topsptiGetCallbackState, topsptiEnableCallback, topsptiEnableDomain, and topsptiEnableAllDomains.

**Parameters:**

- **enable** -- New enable state for all callbacks in all domain. We set it as zero to disable all callbacks, else to enable all callbacks.
- **subscriber** -- Handle for callback subscription

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `subscriber` is unavailable

```cpp
TopsptiResult topsptiGetCallbackName(Topspti_CallbackDomain domain, uint32_t cbid, const char **name)
```

Get the name of a callback for a specified domain and callback ID.

Returns a pointer to the name c string in `**name`.

**Note:**

**Names** are available only for the DRIVER and RUNTIME domains.

**Parameters:**

- **domain** -- The domain of the callback
- **cbid** -- The ID of the callback
- **name** -- Returns pointer to the name string on success, NULL otherwise

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_NOT_INITIALIZED** -- if unable to initialize TOPSPTI
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `name` is NULL, or if `domain` or `cbid` is unavailable.

```cpp
struct Topspti_CallbackData
```

*#include <topspti_callbacks.h>*

Data passed into a driver or runtime API callback function.

Data passed into a driver or runtime API callback function as the `cbdata` argument to Topspti_CallbackFunc. The `cbdata` will be this type for `domain` equal to TOPSPTI_CB_DOMAIN_DRIVER_API or TOPSPTI_CB_DOMAIN_RUNTIME_API. The callback data is only valid when calling the callback function that passes the data. If we need to keep some data for use outside of callbacks, we must copy some data. For example, if a shallow copy of Toppti_CallbackData is made in a callback, we cannot dereference `functionParams` outside of that callback to access function parameters. `functionName` is an exception: the string pointed to by `functionName` is a global constant, so it can be accessed outside of the callback.

#### Public Members

```cpp
Topspti_ApiCallbackSite callbackSite
```

The point in the driver or runtime function where the callback was issued.

```cpp
const char *functionName
```

The name of the driver or runtime API function that issues the callback. It is a global constant, so it can be accessed outside of the callback.

```cpp
const void *functionParams
```

Pointer to the parameters passed to the driver or runtime API call. For the structural definitions of parameters for each driver and runtime API function, please refer to generated_tops_runtime_api_meta.h and generated_tops_meta.h.

```cpp
void *functionReturnValue
```

Pointer to the return value of the driver or runtime API call. This field is only valid in the callback of exit(TOPSPTI_API_EXIT). For a driver API `functionReturnValue` points to NULL. For a runtime API `functionReturnValue` points to a `topsError_t` .

```cpp
const char *symbolName
```

The name of the symbol operated by the driver or runtime API function that issues the callback. This entry is only valid for driver and runtime launch callbacks, it returns the name of the kernel.

```cpp
void *context
```

The current driver context of the thread, if there is no current context, it is null. If a runtime API function initializes a context, TOPSPTI would change the timing of setting this value from the entry to exit callback of the runtime.

```cpp
uint32_t contextUid
```

The unique ID of the TOPS context associated with the thread. UIDs are assigned sequentially as contexts are created and are unique within a process.

```cpp
uint64_t *correlationData
```

Pointer to the shared data between the entry and exit callbacks of a given driver or runtime API function call. This field can be used to pass 64 bit values from the entry callback to the corresponding exit callback.

```cpp
uint32_t correlationId
```

The activity record correlation ID for this callback. For a runtime domain callback (i.e. `domain` TOPSPTI_CB_DOMAIN_RUNTIME_API) this ID will equal the correlation ID in the Topspti_ActivityAPI record corresponding to the TOPS runtime function call. For a driver domain callback (i.e. `domain` TOPSPTI_CB_DOMAIN_DRIVER_API) this ID will equal the correlation ID in the Topspti_ActivityAPI record corresponding to the TOPS driver function call. Within the callback, this ID can be recorded to correlate user data with the activity record.

### 1.3. Result Codes

Error and result codes returned by TOPSPTI functions.

```cpp
enum TopsptiResult
```

TOPSPTI result codes.

Error and result codes returned by TOPSPTI functions.

*Values:*

```cpp
enumerator TOPSPTI_SUCCESS
```

No error.

```cpp
enumerator TOPSPTI_ERROR_INVALID_PARAMETER
```

One or more of the parameters is invalid.

```cpp
enumerator TOPSPTI_ERROR_INVALID_OPERATION
```

The current operation cannot be performed due to dependency on other factors.

```cpp
enumerator TOPSPTI_ERROR_MAX_LIMIT_REACHED
```

The maximum limit is reached.

```cpp
enumerator TOPSPTI_ERROR_NOT_COMPATIBLE
```

The current operation is not compatible with the current state of the object

```cpp
enumerator TOPSPTI_ERROR_NOT_INITIALIZED
```

TOPSPTI is unable to initialize its connection to the driver.

```cpp
enumerator TOPSPTI_ERROR_INVALID_KIND
```

Invalid kind.

```cpp
enumerator TOPSPTI_ERROR_NOT_SUPPORTED
```

The attempted operation is not supported on the current system or device.

```cpp
enumerator TOPSPTI_ERROR_MULTIPLE_SUBSCRIBERS_NOT_SUPPORTED
```

TOPSPTI doesn't allow multiple callback subscribers. Only a single subscriber can be registered at a time. Same error code is used when application is launched using NVIDIA tools like topsprof, Tops Visual Profiler.

```cpp
enumerator TOPSPTI_ERROR_UNKNOWN
```

An unknown internal error has occurred.

```cpp
enumerator TOPSPTI_ERROR_FORCE_INT
```

### 1.4. Version

Function and macro to determine the TOPSPTI version.

```cpp
TopsptiResult topsptiGetVersion(uint32_t *version)
```

Get the TOPSPTI API version.

Return the API version in `*version`.

**See also:**

TOPSPTI_API_VERSION

**Parameters:** **version** -- Returns the version

**Returns:**

- **TOPSPTI_SUCCESS** -- on success
- **TOPSPTI_ERROR_INVALID_PARAMETER** -- if `version` is NULL

```cpp
TOPSPTI_API_VERSION
```

The API version for this implementation of TOPSPTI.

The API version for this implementation of TOPSPTI. This define along with topsptiGetVersion can be used to dynamically detect if the version of TOPSPTI compiled against matches the version of the loaded TOPSPTI library.

v1 : caps 1.4.2 - 1.4.4 v2 : caps 1.4.5 - 1.6.2 v3 : caps 1.6.3 - 1.7.0 v4 : caps 1.7.1 - current

### 1.5. Prof

This section describes the TOPSPTI prof api.

```cpp
const char *TopsptiGetResultString(TopsptiResult res)
```

get the descriptive string for a TopsptiResult

**Parameters:** **res** -- the result to get the string for

**Returns:** result string

```cpp
const char *TopsptiGetProductName(int32_t dev = 0)
```

get the name of product

**Returns:** product name string

```cpp
TopsptiResult TopsptiGetVersion(uint32_t *version)
```

get the TOPSPTI API version

**Parameters:** **version** -- **[out]** the API version

**Returns:** TopsptiResult

```cpp
TopsptiResult TopsptiGetVersion(uint64_t *version)
```

get the TOPSPTI API version

**Parameters:** **version** -- **[out]** the API version

**Returns:** TopsptiResult

```cpp
class topspti::prof::TopsProfiler
```

*#include <topspti_prof_api.h>*

topspti prof profiler definition

#### Public Functions

```cpp
bool Init()
```

Init.

**Returns:** bool

```cpp
TopsptiResult Start()
```

start profiling

**Returns:** TOPSPTI_SUCCESS if success, TOPSPTI_ERROR_INVALID_OPERATION if in wrong state

```cpp
TopsptiResult Stop()
```

stop profiling

**Returns:** TOPSPTI_SUCCESS if success, TOPSPTI_ERROR_INVALID_OPERATION if in wrong state

```cpp
TopsptiResult WaitOnProfile(int milliseconds)
```

wait on runtime process profiling

**Returns:** TopsptiResult

```cpp
TopsptiResult Suspend()
```

suspend profiling

**Returns:** TopsptiResult

```cpp
TopsptiResult Resume()
```

resume profiling

**Returns:** TopsptiResult

```cpp
TopsptiResult Cancel()
```

cancel profiling

**Returns:** TopsptiResult

```cpp
TopsptiResult EventEnum(RawStrToStrsMap &events)
```

enumerate event kinds supported

**Parameters:** **events** -- **[out]** the event kinds supported

**Returns:** TopsptiResult

```cpp
TopsptiResult ActivityEnum(RawStrToStrsMap &acts)
```

enumerate software prof activity kinds supported

**Parameters:** **acts** -- **[out]** the activity kinds supported

**Returns:** TOPSPTI_SUCCESS

```cpp
TopsptiResult MetricEnum(RawStrToStrsMap &metrics)
```

enumerate metrics kinds supported

**Parameters:** **metrics** -- **[out]** the metrics kinds supported

**Returns:** TopsptiResult

```cpp
TopsptiResult ActivityGetIdFromName(TopsptiActivityKind &kind, const char *name)
```

find an activity by name

Example:

```
TopsptiActivityKind kind = TOPSPTI_ACTIVITY_UNKNOWN;
TopsptiResult ret = ActivityGetIdFromName(kind, "Operator");
```

**Parameters:**

- **kind** -- **[out]** the ID of the found activity or undefined if unable to find the activity
- **name** -- the name of activity to find

**Returns:** TopsptiResult

```cpp
TopsptiResult EventGetIdFromName(TopsptiEventKind &kind, const char *name)
```

find an event by name

Example:

```
TopsptiEventKind kind = TOPSPTI_EVENT_UNKNOWN;
TopsptiResult ret = EventGetIdFromName(kind, "SIP Busy With Wait");
```

**Warning:**

experimental API and maybe change later

**Parameters:**

- **kind** -- **[out]** the ID of the found event or undefined if unable to find the event
- **name** -- the name of event to find

**Returns:** TOPSPTI_SUCCESS if success, and TOPSPTI_ERROR_INVALID_PARAMETER if specified `name` is unrecognized

```cpp
TopsptiResult ActivityEnable(TopsptiActivityKind kind)
```

enable collection of a specific kind of activity record

Example:

```
TopsptiResult ret = ActivityEnable(TOPSPTI_ACTIVITY_GENERAL_OPERATOR);
```

**Parameters:** **kind** -- the kind of activity record to enable collecting

**Returns:** TOPSPTI_SUCCESS if success, TOPSPTI_ERROR_INVALID_METRIC if the specified activity `kind` is unrecognized, and TOPSPTI_ERROR_INVALID_OPERATION if the activity has been enabled already

```cpp
TopsptiResult ActivityDisable(TopsptiActivityKind kind)
```

disable collection of a specific kind of activity record

Example:

```
TopsptiResult ret = ActivityDisable(TOPSPTI_ACTIVITY_GENERAL_OPERATOR);
```

**Parameters:** **kind** -- the kind of activity record to disable collecting

**Returns:** TOPSPTI_SUCCESS if success, TOPSPTI_ERROR_INVALID_METRIC if the specified activity `kind` is unrecognized, and TOPSPTI_ERROR_INVALID_OPERATION if the activity has been disabled already

```cpp
TopsptiResult ActivityEnable(const char *kind)
```

enable collection of a specific kind of activity record

Example:

```
TopsptiResult ret = ActivityEnable("Operator");
```

**Parameters:** **kind** -- the kind of activity record to enable collecting

**Returns:** TopsptiResult

```cpp
TopsptiResult ActivityDisable(const char *kind)
```

disable collection of a specific kind of activity record

Example:

```
TopsptiResult ret = ActivityDisable("Operator");
```

**Parameters:** **kind** -- the kind of activity record to disable collecting

**Returns:** TopsptiResult

```cpp
TopsptiResult traceDomainEnable(TopsptiTraceDomainKind kind)
```

enable collection of a specific domain of topstx trace record

Example:

```
TopsptiResult ret = traceDomainEnable(TOPSPTI_TRACE_DOMAIN_TOPSTX);
```

**Parameters:** **kind** -- the domain of topstx trace record to enable collecting

**Returns:** TopsptiResult

```cpp
TopsptiResult traceDomainDisable(TopsptiTraceDomainKind kind)
```

disable collection of a specific domain of topstx trace record

Example:

```
TopsptiResult ret = traceDomainDisable(TOPSPTI_TRACE_DOMAIN_TOPSTX);
```

**Parameters:** **kind** -- the domain of topstx trace record to disable collecting

**Returns:** TopsptiResult

```cpp
TopsptiResult EventEnable(TopsptiEventKind kind)
```

enable collection of a specific kind of event record

Example:

```
TopsptiResult ret = EventEnable(TOPSPTI_EVENT_SIP_PMC_SIP_BUSY_WITH_WAIT);
```

**Warning:**

experimental API and maybe change later

**Parameters:** **kind** -- the kind of event record to enable collecting

**Returns:** TOPSPTI_SUCCESS if success, TOPSPTI_ERROR_INVALID_EVENT if the specified event `kind` is unrecognized, and TOPSPTI_ERROR_INVALID_OPERATION if the event has been enabled already

```cpp
TopsptiResult EventDisable(TopsptiEventKind kind)
```

disable collection of a specific kind of event record

Example:

```
TopsptiResult ret = EventDisable(TOPSPTI_EVENT_SIP_PMC_SIP_BUSY_WITH_WAIT);
```

**Warning:**

experimental API and maybe change later

**Parameters:** **kind** -- the kind of event record to disable collecting

**Returns:** TOPSPTI_SUCCESS if success, TOPSPTI_ERROR_INVALID_EVENT if the specified event `kind` is unrecognized, and TOPSPTI_ERROR_INVALID_OPERATION if the event has been disabled already

```cpp
TopsptiResult EventEnable(const char *kind)
```

enable collection of a specific kind of event record

Example:

```
TopsptiResult ret = EventEnable("SIP Busy With Wait");
```

**Warning:**

experimental API and maybe change later

**Parameters:** **kind** -- the kind of event record to enable collecting

**Returns:** TopsptiResult

```cpp
TopsptiResult EventDisable(const char *kind)
```

disable collection of a specific kind of event record

Example:

```
TopsptiResult ret = EventDisable("SIP Busy With Wait");
```

**Warning:**

experimental API and maybe change later

**Parameters:** **kind** -- the kind of event record to disable collecting

**Returns:** TopsptiResult

```cpp
TopsptiResult MetricsSet(const RawStrVec &metrics)
```

enable collection of a series of metrics

Example:

```
TopsptiResult ret = MetricsSet({"sip/1d_efficiency",
"sip/2d_efficiency"});
```

**Parameters:** **metrics** -- the array of strings containing metric names

**Returns:** TopsptiResult

```cpp
TopsptiResult QueryFusionMetric(const char *fusion_metric, RawStrVec &implied_metrics)
```

query implied metrics enabled by a fusion metric

Example:

```
TopsptiResult ret =
QueryFusionMetric("fusion/LLC_READ_BYTE_WITHOUT_ICACHE",
implied_metrics);
```

**Parameters:**

- **fusion_metric** -- the name of the fusion metric
- **implied_metrics** -- the array of strings containing the implied metric names

**Returns:** TopsptiResult

```cpp
TopsptiResult MetricEnable(const char *metric)
```

enable a specific metric

Example:

```
TopsptiResult ret = MetricEnable("sip/1d_efficiency");
```

**Parameters:** **metric** -- the metric name

**Returns:** TopsptiResult

```cpp
TopsptiResult MetricDisable(const char *metric)
```

disable a specific metric

Example:

```
TopsptiResult ret = MetricDisable("sip/1d_efficiency");
```

**Parameters:** **metric** -- the metric name

**Returns:** TopsptiResult

```cpp
TopsptiResult MetricEnable(TopsptiMetricKind kind)
```

enable a specific metric

Example:

```
TopsptiResult ret = MetricEnable(TOPSPTI_METRIC_SIP_1D_EFFICIENCY);
```

**Parameters:** **kind** -- the kind of the metric

**Returns:** TopsptiResult

```cpp
TopsptiResult MetricDisable(TopsptiMetricKind kind)
```

disable a specific metric

Example:

```
TopsptiResult ret = MetricDisable(TOPSPTI_METRIC_SIP_1D_EFFICIENCY);
```

**Parameters:** **kind** -- the kind of the metric

**Returns:** TopsptiResult

```cpp
TopsptiResult Config(const TopsptiProfileConfig &config)
```

configure profiling

Example:

```
TopsptiProfileConfig config;
config.output = "/tmp/test.data";
TopsptiResult ret = Config(config);
```

**Parameters:** **config** -- software profiling configuration

**Returns:** TOPSPTI_SUCCESS

```cpp
TopsptiResult Process(const char *path)
```

parse raw profiling data from file and compute profiling results

**Parameters:** **path** -- file path to process from

**Returns:** TopsptiResult

```cpp
TopsptiResult Process(const char *path, bool &is_done)
```

parse raw profiling data from file and compute profiling results

**Parameters:**

- **path** -- file path to process from
- **isDone** -- **[out]** the process is done

**Returns:** TopsptiResult

```cpp
TopsptiResult Query(RawStrVec *results, const char *table, const char *column)
```

get the profiling string type results depends on table and column

**Parameters:**

- **results** -- **[out]** the profiling results
- **table** -- table name from vpd.
- **column** -- column name from vpd.

**Returns:** TopsptiResult

```cpp
TopsptiResult Query(std::vector<uint64_t>*results, const char *table, const char *column)
```

get the profiling int type results depends on table and column

**Warning:**

experimental API and maybe change later

**Parameters:**

- **results** -- **[out]** the profiling results
- **table** -- table name from vpd.
- **column** -- column name from vpd.

**Returns:** TopsptiResult

```cpp
TopsptiResult Query(std::vector<double>*results, const char *table, const char *column)
```

get the profiling double type results depends on table and column

**Warning:**

experimental API and maybe change later

**Parameters:**

- **results** -- **[out]** the profiling results
- **table** -- table name from vpd.
- **column** -- column name from vpd.

**Returns:** TopsptiResult

```cpp
TopsptiResult Query(::topspti::database::DataBase *&db)
```

get the profiling results of database proto format

**Parameters:** **db** -- **[out]** profiling results

**Returns:** TopsptiResult

### 1.6. Misc

This section describes the TOPSPTI misc api.

```cpp
class TopsptiProfileConfig
```

*#include <topspti_obj.h>*

profiling software configuration
