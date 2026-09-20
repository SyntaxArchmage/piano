> Imported material source: `Doc/Host Runtime API Reference.md`.
> Image descriptions for this document are listed in this folder's `image_catalog.md` under source document `Host Runtime API Reference`.

# Host Runtime API Reference

## 1. Attribute

### 1.1. GlobalDefs

This section describes Global enum and defines of TOPS runtime API.

```cpp
enum topsDeviceAttribute_t
```

*Values:*

```cpp
enumerator topsDeviceAttributeClockRate
```

Peak clock frequency in kilohertz.

```cpp
enumerator topsDeviceAttributeComputeCapabilityMajor
```

Major compute capability version number.

```cpp
enumerator topsDeviceAttributeComputeCapabilityMinor
```

Minor compute capability version number.

```cpp
enumerator topsDeviceAttributeMaxBlockDimX
```

Max block size in width.

```cpp
enumerator topsDeviceAttributeMaxBlockDimY
```

Max block size in height.

```cpp
enumerator topsDeviceAttributeMaxBlockDimZ
```

Max block size in depth.

```cpp
enumerator topsDeviceAttributeMaxGridDimX
```

Max grid size in width.

```cpp
enumerator topsDeviceAttributeMaxGridDimY
```

Max grid size in height.

```cpp
enumerator topsDeviceAttributeMaxGridDimZ
```

Max grid size in depth.

```cpp
enumerator topsDeviceAttributeMaxThreadsPerBlock
```

Maximum number of threads per block.

```cpp
enumerator topsDeviceAttributeMultiprocessorCount
```

Number of multiprocessors on the device.

```cpp
enumerator topsDeviceAttributeMaxSharedMemoryPerBlock
```

Maximum shared memory available per block in bytes.

```cpp
enumerator topsDeviceAttributeMaxSubThreadsPerBlock
```

Max sub threads.

```cpp
enumerator topsDeviceAttributeEnflameSpecificBegin
```

```cpp
enumerator topsDeviceAttributeEnflameMcChannel
```

Memory Control Channel count.

```cpp
enumerator topsDeviceAttributeSipCount
```

Number of sip.

```cpp
enumerator topsDeviceAttributeSicCount
```

Number of sic.

```cpp
enumerator topsDeviceAttributeMaxThreadsPerSip
```

Max threads per sip.

```cpp
enumerator topsDeviceAttributeMaxSubthreadsPerSip
```

Max sub threads per sip.

```cpp
enumerator topsDeviceAttributeMaxThreadsPerSic
```

Max threads per sic.

```cpp
enumerator topsDeviceAttributeMaxLocalMemoryPerSip
```

Size of local memory region pre sip (in bytes).

```cpp
enumerator topsDeviceAttributeMaxSharedMemoryPerSic
```

Size of shared memory region pre sic (in bytes).

```cpp
enum topsComputeMode
```

*Values:*

```cpp
enumerator topsComputeModeDefault
```

```cpp
enumerator topsComputeModeExclusive
```

```cpp
enumerator topsComputeModeProhibited
```

```cpp
enumerator topsComputeModeExclusiveProcess
```

```cpp
enum topsMemoryAdvise
```

*Values:*

```cpp
enumerator topsMemAdviseSetReadMostly
```

be written to

Data will mostly be read and only occasionally

```cpp
enumerator topsMemAdviseUnsetReadMostly
```

Undo the effect of topsMemAdviseSetReadMostly.

```cpp
enumerator topsMemAdviseSetPreferredLocation
```

the specified device

Set the preferred location for the data as

```cpp
enumerator topsMemAdviseUnsetPreferredLocation
```

Clear the preferred location for the data.

```cpp
enumerator topsMemAdviseSetAccessedBy
```

so prevent page faults as much as possible

Data will be accessed by the specified device,

```cpp
enumerator topsMemAdviseUnsetAccessedBy
```

for the specified device

Let TOPS to decide on the page faulting policy

```cpp
enumerator topsMemAdviseSetCoarseGrain
```

The default memory model is fine-grain. That allows coherent operations between host and device, while executing kernels. The coarse-grain can be used for data that only needs to be coherent at dispatch boundaries for better performance

```cpp
enumerator topsMemAdviseUnsetCoarseGrain
```

Restores cache coherency policy back to fine-grain.

```cpp
enum topsMemRangeCoherencyMode
```

*Values:*

```cpp
enumerator topsMemRangeCoherencyModeFineGrain
```

done coherently from all devices

Updates to memory with this attribute can be

```cpp
enumerator topsMemRangeCoherencyModeCoarseGrain
```

performed by a single device at a time

Writes to memory with this attribute can be

```cpp
enumerator topsMemRangeCoherencyModeIndeterminate
```

Memory region queried contains subregions with both topsMemRangeCoherencyModeFineGrain and topsMemRangeCoherencyModeCoarseGrain attributes

```cpp
enum topsMemRangeAttribute
```

*Values:*

```cpp
enumerator topsMemRangeAttributeReadMostly
```

only occasionally be written to

Whether the range will mostly be read and

```cpp
enumerator topsMemRangeAttributePreferredLocation
```

The preferred location of the range.

```cpp
enumerator topsMemRangeAttributeAccessedBy
```

set for the specified device

Memory range has topsMemAdviseSetAccessedBy

```cpp
enumerator topsMemRangeAttributeLastPrefetchLocation
```

prefetched

The last location to where the range was

```cpp
enumerator topsMemRangeAttributeCoherencyMode
```

topsMemRangeCoherencyMode for the range

Returns coherency mode

```cpp
enum topsMemPoolAttr
```

*Values:*

```cpp
enumerator topsMemPoolReuseFollowEventDependencies
```

(value type = int) Allow `topsMemAllocAsync` to use memory asynchronously freed in another streams as long as a stream ordering dependency of the allocating stream on the free action exists. tops events and null stream interactions can create the required stream ordered dependencies. (default enabled)

```cpp
enumerator topsMemPoolReuseAllowOpportunistic
```

(value type = int) Allow reuse of already completed frees when there is no dependency between the free and allocation. (default enabled)

```cpp
enumerator topsMemPoolReuseAllowInternalDependencies
```

(value type = int) Allow `topsMemAllocAsync` to insert new stream dependencies in order to establish the stream ordering required to reuse a piece of memory released by cuFreeAsync (default enabled).

```cpp
enumerator topsMemPoolAttrReleaseThreshold
```

(value type = uint64_t) Amount of reserved memory in bytes to hold onto before trying to release memory back to the OS. When more than the release threshold bytes of memory are held by the memory pool, the allocator will try to release memory back to the OS on the next call to stream, event or context synchronize. (default 0)

```cpp
enumerator topsMemPoolAttrReservedMemCurrent
```

(value type = uint64_t) Amount of backing memory currently allocated for the mempool.

```cpp
enumerator topsMemPoolAttrReservedMemHigh
```

(value type = uint64_t) High watermark of backing memory allocated for the mempool since the last time it was reset. High watermark can only be reset to zero.

```cpp
enumerator topsMemPoolAttrUsedMemCurrent
```

(value type = uint64_t) Amount of memory from the pool that is currently in use by the application.

```cpp
enumerator topsMemPoolAttrUsedMemHigh
```

(value type = uint64_t) High watermark of the amount of memory from the pool that was in use by the application since the last time it was reset. High watermark can only be reset to zero.

```cpp
enum topsMemLocationType
```

*Values:*

```cpp
enumerator topsMemLocationTypeInvalid
```

```cpp
enumerator topsMemLocationTypeDevice
```

Device location, thus it's TOPS device ID.

```cpp
enum topsMemAccessFlags
```

*Values:*

```cpp
enumerator topsMemAccessFlagsProtNone
```

Default, make the address range not accessible.

```cpp
enumerator topsMemAccessFlagsProtRead
```

Set the address range read accessible.

```cpp
enumerator topsMemAccessFlagsProtReadWrite
```

Set the address range read-write accessible.

```cpp
enum topsMemAllocationType
```

*Values:*

```cpp
enumerator topsMemAllocationTypeInvalid
```

```cpp
enumerator topsMemAllocationTypePinned
```

This allocation type is 'pinned', i.e. cannot migrate from its current location while the application is actively using it

```cpp
enumerator topsMemAllocationTypeMax
```

```cpp
enum topsMemAllocationHandleType
```

*Values:*

```cpp
enumerator topsMemHandleTypeNone
```

Does not allow any export mechanism.

```cpp
enumerator topsMemHandleTypePosixFileDescriptor
```

Allows a file descriptor for exporting. Permitted only on POSIX systems.

```cpp
enumerator topsMemHandleTypeWin32
```

Allows a Win32 NT handle for exporting. (HANDLE)

```cpp
enumerator topsMemHandleTypeWin32Kmt
```

Allows a Win32 KMT handle for exporting. (D3DKMT_HANDLE)

```cpp
enum topsJitOption
```

*Values:*

```cpp
enumerator topsJitOptionMaxRegisters
```

```cpp
enumerator topsJitOptionThreadsPerBlock
```

```cpp
enumerator topsJitOptionWallTime
```

```cpp
enumerator topsJitOptionInfoLogBuffer
```

```cpp
enumerator topsJitOptionInfoLogBufferSizeBytes
```

```cpp
enumerator topsJitOptionErrorLogBuffer
```

```cpp
enumerator topsJitOptionErrorLogBufferSizeBytes
```

```cpp
enumerator topsJitOptionOptimizationLevel
```

```cpp
enumerator topsJitOptionTargetFromContext
```

```cpp
enumerator topsJitOptionTarget
```

```cpp
enumerator topsJitOptionFallbackStrategy
```

```cpp
enumerator topsJitOptionGenerateDebugInfo
```

```cpp
enumerator topsJitOptionLogVerbose
```

```cpp
enumerator topsJitOptionGenerateLineInfo
```

```cpp
enumerator topsJitOptionCacheMode
```

```cpp
enumerator topsJitOptionSm3xOpt
```

```cpp
enumerator topsJitOptionFastCompile
```

```cpp
enumerator topsJitOptionNumOptions
```

```cpp
enum topsFuncAttribute
```

**Warning:**

these hints and controls are ignored.

*Values:*

```cpp
enumerator topsFuncAttributeMaxDynamicSharedMemorySize
```

```cpp
enumerator topsFuncAttributePreferredSharedMemoryCarveout
```

```cpp
enumerator topsFuncAttributeMax
```

```cpp
enum topsFuncCache_t
```

**Warning:**

these hints and controls are ignored.

*Values:*

```cpp
enumerator topsFuncCachePreferNone
```

no preference for shared memory or L1 (default)

```cpp
enumerator topsFuncCachePreferShared
```

prefer larger shared memory and smaller L1 cache

```cpp
enumerator topsFuncCachePreferL1
```

prefer larger L1 cache and smaller shared memory

```cpp
enumerator topsFuncCachePreferEqual
```

prefer equal size L1 cache and shared memory

```cpp
enum topsSharedMemConfig
```

**Warning:**

these hints and controls are ignored.

*Values:*

```cpp
enumerator topsSharedMemBankSizeDefault
```

The compiler selects a device-specific value for the banking.

```cpp
enumerator topsSharedMemBankSizeFourByte
```

when adjacent threads access data 4 bytes apart.

Shared mem is banked at 4-bytes intervals and performs best

```cpp
enumerator topsSharedMemBankSizeEightByte
```

when adjacent threads access data 4 bytes apart.

Shared mem is banked at 8-byte intervals and performs best

```cpp
enum topsLaunchAttributeID
```

Struct for data in 3D

*Values:*

```cpp
enumerator topsLaunchAttributeIgnore
```

```cpp
enumerator topsLaunchAttributeAccessPolicyWindow
```

```cpp
enumerator topsLaunchAttributeCooperative
```

```cpp
enumerator topsLaunchAttributeSynchronizationPolicy
```

```cpp
enumerator topsLaunchAttributeThreadDimension
```

```cpp
enumerator topsLaunchAttributeClusterSchedulingPolicyPreference
```

```cpp
enumerator topsLaunchAttributeProgrammaticStreamSerialization
```

```cpp
enumerator topsLaunchAttributeProgrammaticEvent
```

```cpp
enumerator topsLaunchAttributePriority
```

```cpp
enumerator topsLaunchAttributeMemSyncDomainMap
```

```cpp
enumerator topsLaunchAttributeMemSyncDomain
```

```cpp
enumerator topsLaunchAttributeLaunchCompletionEvent
```

```cpp
enumerator topsLaunchAttributeSchedulingPolicy
```

```cpp
enumerator topsLaunchAttributeUserDefinedName
```

```cpp
enumerator topsLaunchAttributeBlockSharedMemorySize
```

```cpp
enumerator topsLaunchAttributeSkipOaccCheck
```

```cpp
enum topsSchedulingPolicy
```

*Values:*

```cpp
enumerator topsSchedulingPolicyNormal
```

```cpp
enumerator topsSchedulingPolicyRedundant
```

```cpp
enum topsClusterSchedulingPolicy
```

*Values:*

```cpp
enumerator topsClusterSchedulingPolicyDefault
```

```cpp
enumerator topsClusterSchedulingPolicySpread
```

```cpp
enumerator topsClusterSchedulingPolicyLoadBalancing
```

```cpp
enum topsAccessProperty
```

*Values:*

```cpp
enumerator topsAccessPropertyNormal
```

```cpp
enumerator topsAccessPropertyStreaming
```

```cpp
enumerator topsAccessPropertyPersisting
```

```cpp
enum topsSynchronizationPolicy
```

*Values:*

```cpp
enumerator topsSynchronizationPolicyNone
```

```cpp
enum topsLaunchMemSyncDomain
```

*Values:*

```cpp
enumerator topsLaunchMemSyncDomainDefault
```

```cpp
enumerator topsLaunchMemSyncDomainRemote
```

```cpp
enum topsExternalMemoryHandleType_enum
```

*Values:*

```cpp
enumerator topsExternalMemoryHandleTypeOpaqueFd
```

```cpp
enumerator topsExternalMemoryHandleTypeOpaqueWin32
```

```cpp
enumerator topsExternalMemoryHandleTypeOpaqueWin32Kmt
```

```cpp
enumerator topsExternalMemoryHandleTypeD3D12Heap
```

```cpp
enumerator topsExternalMemoryHandleTypeD3D12Resource
```

```cpp
enumerator topsExternalMemoryHandleTypeD3D11Resource
```

```cpp
enumerator topsExternalMemoryHandleTypeD3D11ResourceKmt
```

```cpp
enum topsExternalSemaphoreHandleType_enum
```

*Values:*

```cpp
enumerator topsExternalSemaphoreHandleTypeOpaqueFd
```

```cpp
enumerator topsExternalSemaphoreHandleTypeOpaqueWin32
```

```cpp
enumerator topsExternalSemaphoreHandleTypeOpaqueWin32Kmt
```

```cpp
enumerator topsExternalSemaphoreHandleTypeD3D12Fence
```

```cpp
enum topsGLDeviceList
```

*Values:*

```cpp
enumerator topsGLDeviceListAll
```

All tops devices used by current OpenGL context.

```cpp
enumerator topsGLDeviceListCurrentFrame
```

frame

Tops devices used by current OpenGL context in current

```cpp
enumerator topsGLDeviceListNextFrame
```

frame.

Tops devices used by current OpenGL context in next

```cpp
enum __TOPS_NODISCARD topsError_t topsError_t
```

```cpp
typedef enum topsDeviceAttribute_t topsDeviceAttribute_t
```

```cpp
typedef enum topsMemoryAdvise topsMemoryAdvise
```

```cpp
typedef enum topsMemRangeCoherencyMode topsMemRangeCoherencyMode
```

```cpp
typedef enum topsMemRangeAttribute topsMemRangeAttribute
```

```cpp
typedef enum topsMemPoolAttr topsMemPoolAttr
```

```cpp
typedef enum topsMemLocationType topsMemLocationType
```

```cpp
typedef struct topsMemLocation topsMemLocation
```

Specifies a memory location.

To specify a gpu, set type = `topsMemLocationTypeDevice` and set id = the gpu's device ID

```cpp
typedef enum topsMemAccessFlags topsMemAccessFlags
```

```cpp
typedef struct topsMemAccessDesc topsMemAccessDesc
```

Memory access descriptor

```cpp
typedef enum topsMemAllocationType topsMemAllocationType
```

```cpp
typedef enum topsMemAllocationHandleType topsMemAllocationHandleType
```

```cpp
typedef struct topsMemPoolProps topsMemPoolProps
```

Specifies the properties of allocations made from the pool.

```cpp
typedef struct topsMemPoolPtrExportData topsMemPoolPtrExportData
```

Opaque data structure for exporting a pool allocation

```cpp
typedef enum topsJitOption topsJitOption
```

```cpp
typedef enum topsFuncAttribute topsFuncAttribute
```

**Warning:**

these hints and controls are ignored.

```cpp
typedef enum topsFuncCache_t topsFuncCache_t
```

**Warning:**

these hints and controls are ignored.

```cpp
typedef enum topsSharedMemConfig topsSharedMemConfig
```

**Warning:**

these hints and controls are ignored.

```cpp
typedef enum topsLaunchAttributeID topsLaunchAttributeID_t
```

Struct for data in 3D

```cpp
typedef enum topsSchedulingPolicy topsSchedulingPolicy_t
```

```cpp
typedef enum topsClusterSchedulingPolicy topsClusterSchedulingPolicy_t
```

```cpp
typedef enum topsAccessProperty topsAccessProperty
```

```cpp
typedef enum topsSynchronizationPolicy topsSynchronizationPolicy_t
```

```cpp
typedef enum topsLaunchMemSyncDomain topsLaunchMemSyncDomain_t
```

```cpp
typedef struct topsAccessPolicyWindow topsAccessPolicyWindow
```

```cpp
typedef struct topsLaunchMemSyncDomainMap topsLaunchMemSyncDomainMap_t
```

```cpp
typedef union topsLaunchAttributeValue topsLaunchAttributeValue_t
```

```cpp
typedef struct topsLaunchAttribute topsLaunchAttribute_t
```

```cpp
typedef struct topsLaunchConfig topsLaunchConfig_t
```

```cpp
typedef struct topsLaunchParams_t topsLaunchParams
```

```cpp
typedef enum topsExternalMemoryHandleType_enum topsExternalMemoryHandleType
```

```cpp
typedef struct topsExternalMemoryHandleDesc_st topsExternalMemoryHandleDesc
```

```cpp
typedef struct topsExternalMemoryBufferDesc_st topsExternalMemoryBufferDesc
```

```cpp
typedef void *topsExternalMemory_t
```

```cpp
typedef enum topsExternalSemaphoreHandleType_enum topsExternalSemaphoreHandleType
```

```cpp
typedef struct topsExternalSemaphoreHandleDesc_st topsExternalSemaphoreHandleDesc
```

```cpp
typedef void *topsExternalSemaphore_t
```

```cpp
typedef struct topsExternalSemaphoreSignalParams_st topsExternalSemaphoreSignalParams
```

```cpp
typedef struct topsExternalSemaphoreWaitParams_st topsExternalSemaphoreWaitParams
```

External semaphore wait parameters, compatible with driver type

```cpp
typedef enum topsGLDeviceList topsGLDeviceList
```

```cpp
typedef struct _topsGraphicsResource topsGraphicsResource
```

```cpp
typedef topsGraphicsResource *topsGraphicsResource_t
```

```cpp
__TOPS_NODISCARD
```

```cpp
topsStreamDefault
```

Default stream creation flags. These are used with topsStreamCreate().

```cpp
topsStreamNonBlocking
```

Stream does not implicitly synchronize with null stream.

```cpp
topsStreamCallbackBlocking
```

```cpp
topsStreamNonMerging
```

```cpp
topsEventDefault
```

Default flags.

```cpp
topsEventBlockingSync
```

Waiting will yield CPU. Power-friendly and usage-friendly but may increase latency.

```cpp
topsEventDisableTiming
```

Disable event's capability to record timing information. May improve performance.

```cpp
topsEventInterprocess
```

Event can support IPC. Warning: It is not supported in TOPS.

```cpp
topsEventRecordOnce
```

Event can only support record once. NOTE: tops extern

```cpp
topsEventStrongOrder
```

Event can only support strong order. NOTE: tops extern

```cpp
topsEventDisableQueryAndSync
```

Disable event query/sync operation.

```cpp
topsEventReleaseToDevice
```

Use a device-scope release when recording this event. This flag is useful to obtain more precise timings of commands between events.

```cpp
topsEventReleaseToSystem
```

Use a system-scope release when recording this event. This flag is useful to make non-coherent host memory visible to the host.

```cpp
topsHostMallocDefault
```

Default pinned memory allocation on the host.

```cpp
topsHostMallocPortable
```

Memory is considered allocated by all contexts.

```cpp
topsHostMallocMapped
```

Map the allocation into the address space for the current device. The device pointer can be obtained with topsHostGetDevicePointer.

```cpp
topsHostMallocWriteCombined
```

Allocates the memory as write-combined. On some system configurations, write-combined allocation may be transferred faster across the PCI Express bus, however, could have low read efficiency by most CPUs. It's a good option for data transfer from host to device via mapped pinned memory.

```cpp
topsHostMallocNumaUser
```

Host memory allocation will follow numa policy set by user.

```cpp
topsHostMallocCoherent
```

Allocate coherent memory. Overrides TOPS_COHERENT_HOST_ALLOC for specific allocation.

```cpp
topsHostMallocNonCoherent
```

Allocate non-coherent memory. Overrides TOPS_COHERENT_HOST_ALLOC for specific allocation.

```cpp
topsMemAttachGlobal
```

Memory can be accessed by any stream on any device

```cpp
topsMemAttachHost
```

Memory cannot be accessed by any stream on any device.

```cpp
topsMemAttachSingle
```

Memory can only be accessed by a single stream on the associated device.

```cpp
topsDeviceMallocDefault
```

```cpp
topsDeviceMallocFinegrained
```

Memory is allocated in fine grained region of device.

```cpp
topsMallocSignalMemory
```

Memory represents a HSA signal.

```cpp
topsMallocTopDown
```

Memory allocation from top to down.

```cpp
topsMallocForbidMergeMove
```

Memory allocation with forbidden to do fragment.

```cpp
topsMallocPreferHighSpeedMem
```

Memory allocation prefer to be allocated on high speed mem, if it can not be satisfied, then allocate on global device memory.

```cpp
topsMallocHostAccessable
```

Memory allocation host accessible.

```cpp
topsMallocHostAccessible
```

```cpp
topsMallocForbidAllocFromPool
```

Don't allow alloc from buffer pool, valid for topsExtMallocWithAffinity().

```cpp
topsMallocCodec
```

Alloc memory for codec, valid for topsExtMallocWithAffinity().

```cpp
topsHostRegisterDefault
```

Memory is Mapped but not Portable.

```cpp
topsHostRegisterPortable
```

Memory is considered registered by all contexts.

```cpp
topsHostRegisterMapped
```

Map the allocation into the address space for the current device. The device pointer can be obtained with topsHostGetDevicePointer.

```cpp
topsHostRegisterIoMemory
```

Map the memory-mapped IO memory into the address space for the current device.

```cpp
topsExtHostRegisterCoarseGrained
```

Coarse Grained host memory lock.

```cpp
topsDeviceScheduleAuto
```

Automatically select between Spin and Yield.

```cpp
topsDeviceScheduleSpin
```

Dedicate a CPU core to spin-wait. Provides lowest latency, but burns a CPU core and may consume more power.

```cpp
topsDeviceScheduleYield
```

Yield the CPU to the operating system when waiting. May increase latency, but lowers power and is friendlier to other threads in the system.

```cpp
topsDeviceScheduleBlockingSync
```

```cpp
topsDeviceScheduleMask
```

```cpp
topsDeviceMapHost
```

```cpp
topsDeviceLmemResizeToMax
```

```cpp
topsArrayDefault
```

Default TOPS array allocation flag.

```cpp
topsArrayLayered
```

```cpp
topsArraySurfaceLoadStore
```

```cpp
topsArrayCubemap
```

```cpp
topsArrayTextureGather
```

```cpp
topsOccupancyDefault
```

```cpp
topsCooperativeLaunchMultiDeviceNoPreSync
```

```cpp
topsCooperativeLaunchMultiDeviceNoPostSync
```

```cpp
topsCpuDeviceId
```

```cpp
topsInvalidDeviceId
```

```cpp
topsExtAnyOrderLaunch
```

AnyOrderLaunch of kernels.

```cpp
topsStreamWaitValueGte
```

```cpp
topsStreamWaitValueEq
```

```cpp
topsStreamWaitValueAnd
```

```cpp
topsStreamWaitValueNor
```

```cpp
topsStreamPerThread
```

Implicit stream per application thread.

```cpp
struct itopsStream_t
```

```cpp
struct itopsEvent_t
```

```cpp
struct itopsExecutable_t
```

```cpp
struct itopsResource_t
```

```cpp
struct itopsCtx_t
```

```cpp
struct itopsTensor_t
```

```cpp
struct itopsResourceReservation_t
```

```cpp
struct topsMemLocation
```

*#include <tops_runtime_api.h>*

Specifies a memory location.

To specify a gpu, set type = `topsMemLocationTypeDevice` and set id = the gpu's device ID

```cpp
struct topsMemAccessDesc
```

*#include <tops_runtime_api.h>*

Memory access descriptor

```cpp
struct topsMemPoolProps
```

*#include <tops_runtime_api.h>*

Specifies the properties of allocations made from the pool.

```cpp
struct topsMemPoolPtrExportData
```

*#include <tops_runtime_api.h>*

Opaque data structure for exporting a pool allocation

```cpp
struct topsAccessPolicyWindow
```

```cpp
struct topsLaunchMemSyncDomainMap
```

```cpp
union topsLaunchAttributeValue
```

#### Public Members

```cpp
struct topsAccessPolicyWindow accessPolicyWindow
```

```cpp
unsigned int x
```

```cpp
unsigned int y
```

```cpp
unsigned int z
```

```cpp
struct topsLaunchAttributeValue::[anonymous] ThreadDim
```

```cpp
topsClusterSchedulingPolicy_t clusterSchedulingPolicyPreference
```

```cpp
topsSchedulingPolicy_t SchedulingPolicyPreference
```

```cpp
int cooperative
```

```cpp
topsEvent_t event
```

```cpp
int flags
```

```cpp
int launchCompletionEvent
```

```cpp
enum topsLaunchMemSyncDomain memSyncDomain
```

```cpp
struct topsLaunchMemSyncDomainMap memSyncDomainMap
```

```cpp
int priority
```

```cpp
int programmaticEvent
```

```cpp
int programmaticStreamSerializationAllowed
```

```cpp
enum topsSynchronizationPolicy syncPolicy
```

```cpp
int triggerAtBlockStart
```

```cpp
bool skipOaccCheck
```

```cpp
struct topsLaunchAttribute
```

```cpp
struct topsLaunchConfig
```

```cpp
struct topsLaunchParams_t
```

```cpp
struct topsExternalMemoryHandleDesc_st
```

```cpp
struct topsExternalMemoryBufferDesc_st
```

```cpp
struct topsExternalSemaphoreHandleDesc_st
```

```cpp
struct topsExternalSemaphoreSignalParams_st
```

```cpp
struct topsExternalSemaphoreWaitParams_st
```

*#include <tops_runtime_api.h>*

External semaphore wait parameters, compatible with driver type

### 1.2. GlobalDefsExt

This section describes Ext Global enum and defines of TOPS runtime API.

```cpp
enum topsResLocMode
```

*Values:*

```cpp
enumerator TOPS_RES_LOC__SAME
```

```cpp
enumerator TOPS_RES_LOC__DIST
```

```cpp
enum topsHbmPolicy
```

*Values:*

```cpp
enumerator TOPS_HBM_POLICY__BEST_FIT
```

```cpp
enumerator TOPS_HBM_POLICY__AFFINITY_ONLY
```

```cpp
enumerator TOPS_HBM_POLICY__NONE
```

```cpp
enum topsResBundlMode
```

*Values:*

```cpp
enumerator TOPS_RES_BUNDLE_MODE__UNKNOWN
```

```cpp
enumerator TOPS_RES_BUNDLE_MODE__DEVICE
```

```cpp
enumerator TOPS_RES_BUNDLE_MODE__CLUSTER
```

```cpp
enumerator TOPS_RES_BUNDLE_MODE__VG
```

```cpp
enumerator TOPS_RES_BUNDLE_MODE__PG
```

```cpp
enumerator TOPS_RES_BUNDLE_MODE__USER
```

```cpp
enum topsResourceReservationType_enum
```

Types of resource reservation to device.

*Values:*

```cpp
enumerator TOPS_RESOURCE_RESERVATION_TYPE_PROCESSOR_COUNT
```

Set the processors available to the context.

```cpp
enumerator TOPS_RESOURCE_RESERVATION_TYPE_SHARED_MEMORY_SIZE
```

Set the shared memory available to the context.

```cpp
enumerator TOPS_RESOURCE_RESERVATION_TYPE_GLOBAL_MEMORY_SIZE
```

Set the global memory available to the context.

```cpp
enum topsResourceAffinityType_enum
```

Types of resource affinity to current context.

*Values:*

```cpp
enumerator TOPS_RESOURCE_AFFINITY_TYPE_GLOBAL_MEMORY_SIZE
```

Set the hbm available to the context.

```cpp
enumerator TOPS_RESOURCE_AFFINITY_TYPE_SHARED_MEMORY_SIZE
```

Set the shared memory available to the context.

```cpp
enumerator TOPS_RESOURCE_AFFINITY_TYPE_MAX
```

```cpp
enum topsExecutableInfoType
```

topsExecutableInfoType types

*Values:*

```cpp
enumerator topsExecutableInfoInputCount
```

```cpp
enumerator topsExecutableInfoOutputCount
```

```cpp
enumerator topsExecutableInfoInputSizeList
```

```cpp
enumerator topsExecutableInfoOutputSizeList
```

```cpp
enumerator topsExecutableInfoInputRank
```

```cpp
enumerator topsExecutableInfoInputDimsList
```

```cpp
enumerator topsExecutableInfoOutputRank
```

```cpp
enumerator topsExecutableInfoOutputDimsList
```

```cpp
enumerator topsExecutableInfoInputDataTypeList
```

```cpp
enumerator topsExecutableInfoOutputDataTypeList
```

```cpp
enumerator topsExecutableInfoTensorTableSize
```

```cpp
enumerator topsExecutableInfoInputMinDimsList
```

```cpp
enumerator topsExecutableInfoInputMaxDimsList
```

```cpp
enumerator topsExecutableInfoOutputMaxDimsList
```

```cpp
enumerator topsExecutableInfoBlockCount
```

```cpp
enumerator topsExecutableInfoInputBankList
```

```cpp
enumerator topsExecutableInfoOutputBankList
```

```cpp
enumerator topsExecutableInfoThreadNumberPerBlock
```

```cpp
enumerator topsExecutableInfoTargetName
```

```cpp
enumerator topsExecutableInfoIsHostCompile
```

```cpp
enumerator topsExecutableInfoMcCount
```

```cpp
enumerator topsExecutableInfoConstantCount
```

```cpp
enumerator topsExecutableInfoDynamicFlag
```

```cpp
enum topsResourceBundleInfoType
```

topsResourceBundleInfoType types

*Values:*

```cpp
enumerator topsResourceBundleProcessorCount
```

```cpp
enum topsReduceOpType
```

Reduce Operation define.

*Values:*

```cpp
enumerator TOPS_REDUCE_OP_SUM
```

```cpp
enumerator TOPS_REDUCE_OP_PROD
```

```cpp
enumerator TOPS_REDUCE_OP_MAX
```

```cpp
enumerator TOPS_REDUCE_OP_MIN
```

```cpp
enumerator TOPS_REDUCE_OP_UNKNOW
```

```cpp
enum topsReduceDataType
```

Reduce Data type define.

*Values:*

```cpp
enumerator TOPS_REDUCE_DATA_INT8
```

```cpp
enumerator TOPS_REDUCE_DATA_CHAR
```

```cpp
enumerator TOPS_REDUCE_DATA_UINT8
```

```cpp
enumerator TOPS_REDUCE_DATA_INT32
```

```cpp
enumerator TOPS_REDUCE_DATA_INT
```

```cpp
enumerator TOPS_REDUCE_DATA_UINT32
```

```cpp
enumerator TOPS_REDUCE_DATA_INT64
```

```cpp
enumerator TOPS_REDUCE_DATA_UINT64
```

```cpp
enumerator TOPS_REDUCE_DATA_FLOAT16
```

```cpp
enumerator TOPS_REDUCE_DATA_HALF
```

```cpp
enumerator TOPS_REDUCE_DATA_FLOAT32
```

```cpp
enumerator TOPS_REDUCE_DATA_FLOAT
```

```cpp
enumerator TOPS_REDUCE_DATA_LFLOAT64
```

```cpp
enumerator TOPS_REDUCE_DATA_DOUBLE
```

```cpp
enumerator TOPS_REDUCE_DATA_BFLOAT16
```

```cpp
enumerator TOPS_REDUCE_DATA_UNKNOW
```

```cpp
enum topsExtExecutableSectionHeaderType
```

topsExecutable section header types

*Values:*

```cpp
enumerator SHT_NULL_
```

```cpp
enumerator SHT_HEADER
```

```cpp
enumerator SHT_RESOURCE
```

```cpp
enumerator SHT_INPUT
```

```cpp
enumerator SHT_OUT
```

```cpp
enumerator SHT_CONSTANT
```

```cpp
enumerator SHT_SIPCODE
```

```cpp
enumerator SHT_SIP_FUNC_PARAM
```

```cpp
enumerator SHT_SIP_FUNC_PARAM_UPDATE
```

```cpp
enumerator SHT_STREAM
```

```cpp
enumerator SHT_PACKET
```

```cpp
enumerator SHT_PACKET_UPDATE
```

```cpp
enumerator SHT_CLUSTER
```

```cpp
enumerator SHT_JITBINARY
```

```cpp
enumerator SHT_CPU_FUNC_PARAM
```

```cpp
enumerator SHT_CPU_FUNC_DATA
```

```cpp
enumerator SHT_CPU_FUNCTION
```

```cpp
enumerator SHT_PROFILE
```

```cpp
enumerator SHT_HOST_CONST
```

```cpp
enumerator SHT_TASK
```

```cpp
enumerator SHT_SIP_CALLBACK
```

```cpp
enumerator SHT_TARGET_RESOURCE
```

```cpp
enumerator SHT_TENSOR_TABLE
```

```cpp
enumerator SHT_KERNEL_ASSERT_INFO
```

```cpp
enumerator SHT_RAND_STATE
```

```cpp
enumerator SHT_HOST_PROGRAM
```

```cpp
enumerator SHT_RODATA
```

```cpp
enumerator SHT_MANAGED_CONSTANT
```

```cpp
enumerator SHT_USER5
```

```cpp
enumerator SHT_USER6
```

```cpp
enumerator SHT_USER7
```

```cpp
enumerator SHT_USER8
```

```cpp
enumerator SHT_USER9
```

```cpp
enumerator SHT_LAST_TYPE
```

```cpp
enum topsRoceOpCode
```

*Values:*

```cpp
enumerator TOPS_ROCE_OP_SEND
```

```cpp
enumerator TOPS_ROCE_OP_SEND_INLINE
```

```cpp
enumerator TOPS_ROCE_OP_WRITE
```

```cpp
enumerator TOPS_ROCE_OP_WRITE_INLINE
```

```cpp
enumerator TOPS_ROCE_OP_READ_REQ
```

```cpp
enumerator TOPS_ROCE_OP_READ_RES
```

```cpp
enumerator TOPS_ROCE_OP_RECEIVE
```

```cpp
enumerator TOPS_ROCE_OP_ATOMIC_STORE
```

```cpp
typedef struct itopsExecutable_t *topsExecutable_t
```

```cpp
typedef struct itopsResource_t *topsResource_t
```

```cpp
typedef struct topsResourceBundle topsResourceBundle_t
```

```cpp
typedef struct topsResourceRequest topsResourceRequest_t
```

topsResourceRequest descriptor

```cpp
typedef struct itopsResourceReservation_t *topsResourceReservation_t
```

An opaque value that represents a tops resource reservation

```cpp
typedef enum topsResourceReservationType_enum topsResourceReservationType
```

Types of resource reservation to device.

```cpp
typedef struct topsResourceReservationProcessorCount_st topsResourceReservationProcessorCount_v1
```

val for TOPS_RESOURCE_RESERVATION_TYPE_PROCESSOR_COUNT.

```cpp
typedef topsResourceReservationProcessorCount_v1 topsResourceReservationProcessorCount
```

```cpp
typedef struct topsResourceReservationSharedMemorySize_st topsResourceReservationSharedMemorySize_v1
```

val for TOPS_RESOURCE_RESERVATION_TYPE_SHARED_MEMORY_SIZE.

```cpp
typedef topsResourceReservationSharedMemorySize_v1 topsResourceReservationSharedMemorySize
```

```cpp
typedef struct topsResourceReservationGlobalMemorySize_st topsResourceReservationGlobalMemorySize_v1
```

val for TOPS_RESOURCE_RESERVATION_TYPE_GLOBAL_MEMORY_SIZE.

```cpp
typedef topsResourceReservationGlobalMemorySize_v1 topsResourceReservationGlobalMemorySize
```

```cpp
typedef struct topsResourceReservationParam_st topsResourceReservationParam_v1
```

Resource reservation parameters.

```cpp
typedef topsResourceReservationParam_v1 topsResourceReservationParam
```

```cpp
typedef enum topsResourceAffinityType_enum topsResourceAffinityType
```

Types of resource affinity to current context.

```cpp
typedef struct topsResourceAffinityGlobalMemorySize_st topsResourceAffinityGlobalMemorySize_v1
```

val for TOPS_RESOURCE_AFFINITY_TYPE_GLOBAL_MEMORY_SIZE.

```cpp
typedef topsResourceAffinityGlobalMemorySize_v1 topsResourceAffinityGlobalMemorySize
```

```cpp
typedef struct topsResourceAffinitySharedMemorySize_st topsResourceAffinitySharedMemorySize_v1
```

val for TOPS_RESOURCE_AFFINITY_TYPE_SHARED_MEMORY_SIZE.

```cpp
typedef topsResourceAffinitySharedMemorySize_v1 topsResourceAffinitySharedMemorySize
```

```cpp
typedef struct topsResourceAffinity_st topsResourceAffinity_v1
```

Resource affinity parameters.

```cpp
typedef topsResourceAffinity_v1 topsResourceAffinity
```

```cpp
typedef enum topsExecutableInfoType topsExecutableInfoType_t
```

topsExecutableInfoType types

```cpp
typedef enum topsResourceBundleInfoType topsResourceBundleInfoType_t
```

topsResourceBundleInfoType types

```cpp
typedef struct topsKernelDescriptor topsKernelDescriptor_t
```

```cpp
typedef struct topsExtLaunchParams topsExtLaunchParams_t
```

topsExtLaunchParams descriptor

```cpp
typedef struct topsCooperativeKernelNodeParams topsCooperativeKernelNodeParams
```

```cpp
typedef enum topsReduceOpType topsReduceOpType_t
```

Reduce Operation define.

```cpp
typedef enum topsReduceDataType topsReduceDataType_t
```

Reduce Data type define.

```cpp
typedef struct topsExtExecutableSectionInfo topsExtExecutableSectionInfo_t
```

topsExecutable section information

```cpp
typedef enum topsExtExecutableSectionHeaderType topsExtExecutableSectionHeaderType_t
```

topsExecutable section header types

```cpp
typedef struct topsShape topsShape_t
```

shape of input/output

```cpp
typedef struct topsTensorStruct topsTensorStruct_t
```

```cpp
typedef enum topsRoceOpCode topsRoceOpCode_t
```

```cpp
typedef struct topsRoceSendWR topsRoceSendWR_t
```

```cpp
typedef struct topsRoceQueueAttribute topsRoceQueueAttribute_t
```

```cpp
MAX_CDMA_ENGINE_NUM_ON_20
```

```cpp
TOPS_SHAPE_INFER_MAX_DIMS
```

max dims of input/output

```cpp
TOPS_ROCE_QUEUE_ATTR_PORT
```

```cpp
TOPS_ROCE_QUEUE_ATTR_DEST_QID
```

```cpp
TOPS_ROCE_QUEUE_ATTR_DEST_AH
```

```cpp
struct topsResourceBundle
```

```cpp
struct topsResourceRequest
```

*#include <tops_ext.h>*

topsResourceRequest descriptor

```cpp
struct topsResourceReservationProcessorCount_st
```

*#include <tops_ext.h>*

val for TOPS_RESOURCE_RESERVATION_TYPE_PROCESSOR_COUNT.

```cpp
struct topsResourceReservationSharedMemorySize_st
```

*#include <tops_ext.h>*

val for TOPS_RESOURCE_RESERVATION_TYPE_SHARED_MEMORY_SIZE.

```cpp
struct topsResourceReservationGlobalMemorySize_st
```

*#include <tops_ext.h>*

val for TOPS_RESOURCE_RESERVATION_TYPE_GLOBAL_MEMORY_SIZE.

```cpp
struct topsResourceReservationParam_st
```

*#include <tops_ext.h>*

Resource reservation parameters.

```cpp
struct topsResourceAffinityGlobalMemorySize_st
```

*#include <tops_ext.h>*

val for TOPS_RESOURCE_AFFINITY_TYPE_GLOBAL_MEMORY_SIZE.

```cpp
struct topsResourceAffinitySharedMemorySize_st
```

*#include <tops_ext.h>*

val for TOPS_RESOURCE_AFFINITY_TYPE_SHARED_MEMORY_SIZE.

```cpp
struct topsResourceAffinity_st
```

*#include <tops_ext.h>*

Resource affinity parameters.

```cpp
struct topsKernelDescriptor
```

```cpp
struct topsExtLaunchParams
```

*#include <tops_ext.h>*

topsExtLaunchParams descriptor

```cpp
struct topsCooperativeKernelNodeParams
```

```cpp
struct topsExtExecutableSectionInfo
```

*#include <tops_ext.h>*

topsExecutable section information

```cpp
struct topsHighspeedMemConfig_t
```

```cpp
struct topsShape
```

*#include <tops_ext.h>*

shape of input/output

```cpp
struct topsTensorStruct
```

```cpp
struct topsRoceSendWR
```

```cpp
struct topsRoceQueueAttribute
```

## 2. API Function

### 2.1. Driver

This section describes the Driver Initialization and Version.

```cpp
TOPS_PUBLIC_API topsError_t topsInit(unsigned int flags)
```

Explicitly initializes the TOPS runtime.

Most TOPS APIs implicitly initialize the TOPS runtime. This API provides control over the timing of the initialization.

```cpp
TOPS_PUBLIC_API topsError_t topsDriverGetVersion(int *driverVersion)
```

Returns the approximate TOPS driver version.

The version is returned as (1000 major + 10 minor). For example, topsrider 2.2 would be represented by 2020.

**See also:**

topsRuntimeGetVersion

**Parameters:** **driverVersion** -- **[out]**

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsRuntimeGetVersion(int *runtimeVersion)
```

Returns the approximate TOPS Runtime version.

The version is returned as (1000 major + 10 minor). For example, topsrider 2.2 would be represented by 2020.

**See also:**

topsDriverGetVersion

**Parameters:** **runtimeVersion** -- **[out]**

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGet(topsDevice_t *device, int ordinal)
```

Returns a handle to a compute device.

**Parameters:**

- **device** -- **[out]**
- **ordinal** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceComputeCapability(int *major, int *minor, topsDevice_t device)
```

Returns the compute capability of the device.

**Parameters:**

- **major** -- **[out]**
- **minor** -- **[out]**
- **device** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGetName(char *name, int len, topsDevice_t device)
```

Returns an identifier string for the device.

**Warning:**

these versions are ignored.

**Parameters:**

- **name** -- **[out]**
- **len** -- **[in]**
- **device** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGetPCIBusId(char *pciBusId, int len, int device)
```

Returns a PCI Bus Id string for the device, overloaded to take int device ID.

**Parameters:**

- **pciBusId** -- **[out]**
- **len** -- **[in]**
- **device** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGetByPCIBusId(int *device, const char *pciBusId)
```

Returns a handle to a compute device.

**Parameters:**

- **device** -- **[out]** handle
- **pciBusId** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceTotalMem(size_t *bytes, topsDevice_t device)
```

Returns the total amount of memory on the device.

**Parameters:**

- **bytes** -- **[out]**
- **device** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidDevice

### 2.2. Device

This section describes the device management functions of TOPS runtime API.

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceSynchronize(void)
```

Waits on all active streams on current device.

When this command is invoked, the host thread gets blocked until all the commands associated with streams associated with the device or the reservation if current thread is set with a reservation. TOPS does not support multiple blocking modes (yet!).

**See also:**

topsSetDevice, topsDeviceReset

**Returns:** topsSuccess

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceReset(void)
```

The state of current device is discarded and updated to a fresh state.

Calling this function deletes all streams created, memory allocated, kernels running, events created. Make sure that no other thread is using the device or streams, memory, kernels, events associated with the current device.

**See also:**

topsDeviceSynchronize

**Returns:** topsSuccess

```cpp
TOPS_PUBLIC_API topsError_t topsSetDevice(int deviceId)
```

Set default device to be used for subsequent tops API calls from this thread.

Sets `device` as the default device for the calling host thread. Valid device id's are 0... (topsGetDeviceCount()-1).

Many TOPS APIs implicitly use the "default device" :

- Any device memory subsequently allocated from this host thread (using topsMalloc) will be allocated on device.
- Any streams or events created from this host thread will be associated with device.
- Any kernels launched from this host thread (using topsLaunchKernel) will be executed on device (unless a specific stream is specified, in which case the device associated with that stream will be used).

This function may be called from any host thread. Multiple host threads may use the same device. This function does no synchronization with the previous or new device, and has very little runtime overhead. Applications can use topsSetDevice to quickly switch the default device before making a TOPS runtime call which uses the default device.

The default device is stored in thread-local-storage for each thread. Thread-pool implementations may inherit the default device of the previous thread. A good practice is to always call topsSetDevice at the start of TOPS coding sequency to establish a known standard device.

**See also:**

topsGetDevice, topsGetDeviceCount

**Parameters:** **deviceId** -- **[in]** Valid device in range 0...(topsGetDeviceCount()-1).

**Returns:** topsSuccess, topsErrorInvalidDevice, #topsErrorDeviceAlreadyInUse

```cpp
TOPS_PUBLIC_API topsError_t topsGetDevice(int *deviceId)
```

Return the default device id for the calling host thread.

TOPS maintains an default device for each thread using thread-local-storage. This device is used implicitly for TOPS runtime APIs called by this thread. topsGetDevice returns in * `device` the default device for the calling host thread.

**Parameters:** **deviceId** -- **[out]** *deviceId is written with the default device

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGetDeviceCount(int *count)
```

Return number of compute-capable devices.

Returns in `*count` the number of devices that have ability to run compute commands. If there are no such devices, then topsGetDeviceCount will return topsErrorNoDevice. If 1 or more devices can be found, then topsGetDeviceCount returns topsSuccess.

**Parameters:** **[output]** -- count Returns number of compute-capable devices.

**Returns:** topsSuccess, topsErrorNoDevice

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGetAttribute(int *pi, topsDeviceAttribute_t attr, int deviceId)
```

Query for a specific device attribute.

**Parameters:**

- **pi** -- **[out]** pointer to value to return
- **attr** -- **[in]** attribute to query
- **deviceId** -- **[in]** which device to query for information

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGetDeviceProperties(topsDeviceProp_t *prop, int deviceId)
```

Returns device properties.

Populates topsGetDeviceProperties with information for the specified device.

**Parameters:**

- **prop** -- **[out]** written with device properties
- **deviceId** -- **[in]** which device to query for information

**Returns:** topsSuccess, topsErrorInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceSetLimit(topsLimit_t limit, size_t value)
```

Set Resource limits of current device.

**Parameters:**

- **limit** -- **[in]**
- **value** -- **[in]**

**Returns:** topsSuccess, #topsErrorUnsupportedLimit, topsErrorInvalidValue Note: Currently, only topsLimitMallocHeapSize/topsLimitMaxThreadsPerBlock/topsLimitMultiProcessorCount are available

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGetLimit(size_t *pValue, enum topsLimit_t limit)
```

Get Resource limits of current device.

**Parameters:**

- **pValue** -- **[out]**
- **limit** -- **[in]**

**Returns:** topsSuccess, #topsErrorUnsupportedLimit, topsErrorInvalidValue Note: Currently, only topsLimitMallocHeapSize/topsLimitMaxThreadsPerBlock/topsLimitMultiProcessorCount are available

```cpp
TOPS_PUBLIC_API topsError_t topsGetDeviceFlags(unsigned int *flags)
```

Gets the flags set for current device.

**Parameters:** **flags** -- **[out]**

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsSetDeviceFlags(unsigned flags)
```

The current device behavior is changed according the flags passed.

topsDeviceScheduleSpin : TOPS runtime will actively spin in the thread which submitted the work until the command completes. This offers the lowest latency, but will consume a CPU core and may increase power.

topsDeviceScheduleYield : The TOPS runtime will yield the CPU to system so that other tasks can use it. This may increase latency to detect the completion but will consume less power and is friendlier to other tasks in the system.

topsDeviceScheduleBlockingSync : This is a synonym for topsDeviceScheduleYield.

topsDeviceScheduleAuto : Use a heuristic to select between Spin and Yield modes. If the number of TOPS contexts is greater than the number of logical processors in the system, use Spin scheduling. Else use Yield scheduling.

topsDeviceMapHost : Allow mapping host memory. On GCU, this is always allowed and the flag is ignored.

topsDeviceLmemResizeToMax :

**Warning:**

GCU silently ignores this flag.

**Parameters:** **flags** -- **[in]** The schedule flags impact how TOPS waits for the completion of a command running on a device.

**Returns:** topsSuccess, topsErrorInvalidDevice, #topsErrorSetOnActiveProcess

```cpp
TOPS_PUBLIC_API topsError_t topsChooseDevice(int *device, const topsDeviceProp_t *prop)
```

Device which matches topsDeviceProp_t is returned.

**Parameters:**

- **device** -- **[out]** The device ID
- **prop** -- **[in]** The device properties pointer

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsIpcGetMemHandle(topsIpcMemHandle_t *handle, void *devPtr)
```

Gets an interprocess memory handle for an existing device memory allocation.

Takes a pointer to the base of an existing device memory allocation created with topsMalloc and exports it for use in another process. This is a lightweight operation and may be called multiple times on an allocation without adverse effects.

If a region of memory is freed with topsFree and a subsequent call to topsMalloc returns memory with the same device address, topsIpcGetMemHandle will return a unique handle for the new memory.

**Parameters:**

- **handle** -- Pointer to user allocated topsIpcMemHandle to return the handle in.
- **devPtr** -- Base pointer to previously allocated device memory

**Returns:** topsSuccess, topsErrorInvalidHandle, topsErrorOutOfMemory, topsErrorMapFailed,

```cpp
TOPS_PUBLIC_API topsError_t topsIpcOpenMemHandle(void **devPtr, topsIpcMemHandle_t handle, unsigned int flags)
```

Opens an interprocess memory handle exported from another process and returns a device pointer usable in the local process.

Maps memory exported from another process with topsIpcGetMemHandle into the current device address space. For contexts on different devices topsIpcOpenMemHandle can attempt to enable peer access between the devices as if the user called topsDeviceEnablePeerAccess. This behavior is controlled by the topsIpcMemLazyEnablePeerAccess flag. topsDeviceCanAccessPeer can determine if a mapping is possible.

Contexts that may open topsIpcMemHandles are restricted in the following way. topsIpcMemHandles from each device in a given process may only be opened by one context per device per other process.

Memory returned from topsIpcOpenMemHandle must be freed with topsIpcCloseMemHandle.

Calling topsFree on an exported memory region before calling topsIpcCloseMemHandle in the importing context will result in undefined behavior.

**Note:**

No guarantees are made about the address returned in `*devPtr`. In particular, multiple processes may not receive the same address for the same `handle`.

**Parameters:**

- **devPtr** -- Returned device pointer
- **handle** -- topsIpcMemHandle to open
- **flags** -- Flags for this operation. currently only flag 0 is supported

**Returns:** topsSuccess, topsErrorMapFailed, topsErrorInvalidHandle, topsErrorTooManyPeers

```cpp
TOPS_PUBLIC_API topsError_t topsIpcCloseMemHandle(void *devPtr)
```

Close memory mapped with topsIpcOpenMemHandle.

Unmaps memory returned by topsIpcOpenMemHandle. The original allocation in the exporting process as well as imported mappings in other processes will be unaffected.

Any resources used to enable peer access will be freed if this is the last mapping using them.

**Parameters:** **devPtr** -- Device pointer returned by topsIpcOpenMemHandle

**Returns:** topsSuccess, topsErrorMapFailed, topsErrorInvalidHandle,

```cpp
TOPS_PUBLIC_API topsError_t topsIpcGetEventHandle(topsIpcEventHandle_t *handle, topsEvent_t event)
```

Gets an opaque interprocess handle for an event.

This opaque handle may be copied into other processes and opened with topsIpcOpenEventHandle. Then topsEventRecord, topsEventSynchronize, topsEventQuery may be used in remote processes. The topsStreamWaitEvent is called in local processes only. Operations on the imported event after the exported event has been freed with topsEventDestroy will result in undefined behavior.

**Parameters:**

- **handle** -- **[out]** Pointer to topsIpcEventHandle to return the opaque event handle
- **event** -- **[in]** Event allocated with topsEventInterprocess and topsEventDisableTiming flags

**Returns:** topsSuccess, #topsErrorInvalidConfiguration, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsIpcOpenEventHandle(topsEvent_t *event, topsIpcEventHandle_t handle)
```

Opens an interprocess event handle.

Opens an interprocess event handle exported from another process with topsIpcGetEventHandle. The returned topsEvent_t behaves like a locally created event with the topsEventDisableTiming flag specified. This event need be freed with topsEventDestroy. Operations on the imported event after the exported event has been freed with topsEventDestroy will result in undefined behavior. If the function is called within the same process where handle is returned by topsIpcGetEventHandle, it will return topsErrorInvalidContext.

**Parameters:**

- **event** -- **[out]** Pointer to topsEvent_t to return the event
- **handle** -- **[in]** The opaque interprocess handle to open

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidContext

```cpp
TOPS_PUBLIC_API topsError_t topsIpcOpenEventHandleExt(topsEvent_t *event, topsIpcEventHandle_t handle, topsTopologyMapType map, int port)
```

Opens an interprocess event handle with topsTopologyMapType.

Opens an interprocess event handle exported from another process with topsIpcGetEventHandle. The returned topsEvent_t behaves like a locally created event with the topsEventDisableTiming flag specified. This event need be freed with topsEventDestroy. Operations on the imported event after the exported event has been freed with topsEventDestroy will result in undefined behavior. If the function is called within the same process where handle is returned by topsIpcGetEventHandle, it will return topsErrorInvalidContext.

Note. This function is only supported when the event is exported for a remote process on a different device. If the event is exported for a remote process on the same device, please use topsIpcOpenEventHandle instead.

**Parameters:**

- **event** -- **[out]** Pointer to topsEvent_t to return the event
- **handle** -- **[in]** The opaque interprocess handle to open
- **map** -- **[in]** The link that is expected to pass
- **port** -- **[in]** ESL port id

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidContext

```cpp
TOPS_PUBLIC_API topsError_t topsOpenEventHandle(topsEvent_t *event, topsEvent_t handle)
```

Opens an event for the same process.

Opens a same process event handle exported from another device with topsEventCreateWithFlags. The returned topsEvent_t behaves like a locally created event with the topsEventDisableTiming flag specified. This event need be freed with topsEventDestroy. Operations on the imported event after the exported event has been freed with topsEventDestroy will result in undefined behavior.

**Parameters:**

- **event** -- **[out]** Pointer to topsEvent_t to return the event
- **handle** -- **[in]** The another device event handle to open

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidContext

```cpp
TOPS_PUBLIC_API topsError_t topsOpenEventHandleExt(topsEvent_t *event, topsEvent_t handle, topsTopologyMapType map, int port)
```

Opens an event for the same process with topsTopologyMapType.

Opens a same process event handle exported from another device with topsEventCreateWithFlags. The returned topsEvent_t behaves like a locally created event with the topsEventDisableTiming flag specified. This event need be freed with topsEventDestroy. Operations on the imported event after the exported event has been freed with topsEventDestroy will result in undefined behavior.

**Parameters:**

- **event** -- **[out]** Pointer to topsEvent_t to return the event
- **handle** -- **[in]** The another device event handle to open
- **map** -- **[in]** The link that is expected to pass
- **port** -- **[in]** ESL port id

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidContext

### 2.3. Error

This section describes the error handling functions of TOPS runtime API.

```cpp
TOPS_PUBLIC_API topsError_t topsGetLastError(void)
```

Return last error returned by any TOPS runtime API call and resets the stored error code to topsSuccess.

Returns the last error that has been returned by any of the runtime calls in the same host thread, and then resets the saved error to topsSuccess.

**See also:**

topsGetErrorString, topsGetLastError, topsPeekAtLastError, topsError_t

**Returns:** return code from last TOPS called from the active host thread

```cpp
TOPS_PUBLIC_API topsError_t topsPeekAtLastError(void)
```

Return last error returned by any TOPS runtime API call.

Returns the last error that has been returned by any of the runtime calls in the same host thread. Unlike topsGetLastError, this function does not reset the saved error code.

**See also:**

topsGetErrorString, topsGetLastError, topsPeekAtLastError, topsError_t

**Returns:** topsSuccess

```cpp
TOPS_PUBLIC_API const char *topsGetErrorName(topsError_t tops_error)
```

Return name of the specified error code in text form.

**See also:**

topsGetErrorString, topsGetLastError, topsPeekAtLastError, topsError_t

**Parameters:** **tops_error** -- Error code to convert to name.

**Returns:** const char pointer to the NULL-terminated error name

```cpp
TOPS_PUBLIC_API const char *topsGetErrorString(topsError_t topsError)
```

Return handy text string message to explain the error which occurred.

**See also:**

topsGetErrorName, topsGetLastError, topsPeekAtLastError, topsError_t

**Warning:**

This function returns the name of the error (same as topsGetErrorName)

**Parameters:** **topsError** -- Error code to convert to string.

**Returns:** const char pointer to the NULL-terminated error string

### 2.4. Stream

This section describes the stream management functions of TOPS runtime API.

```cpp
typedef void(*topsStreamCallback_t)(topsStream_t stream, topsError_t status, void *userData)
```

Stream CallBack struct

```cpp
TOPS_PUBLIC_API topsError_t topsStreamCreate(topsStream_t *stream)
```

Create an asynchronous stream.

Create a new asynchronous stream. `stream` returns an opaque handle that can be used to reference the newly created stream in subsequent topsStream* commands. The stream is allocated on the heap and will remain allocated even if the handle goes out-of-scope. To release the memory used by the stream, application must call topsStreamDestroy.

**See also:**

topsStreamSynchronize, topsStreamWaitEvent, topsStreamDestroy

**Parameters:** **stream** -- **[inout]** Pointer to new stream

**Returns:** topsSuccess, topsErrorInvalidValue

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsStreamCreateWithFlags(topsStream_t *stream, unsigned int flags)
```

Create an asynchronous stream.

Create a new asynchronous stream. `stream` returns an opaque handle that can be used to reference the newly created stream in subsequent topsStream* commands. The stream is allocated on the heap and will remain allocated even if the handle goes out-of-scope. To release the memory used by the stream, application must call topsStreamDestroy. Flags controls behavior of the stream. See topsStreamDefault, topsStreamNonBlocking.

**See also:**

topsStreamSynchronize, topsStreamWaitEvent, topsStreamDestroy

**Parameters:**

- **stream** -- **[inout]** Pointer to new stream
- **flags** -- **[in]** to control stream creation.

**Returns:** topsSuccess, topsErrorInvalidValue

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsStreamCreateWithLaunchLimit(topsStream_t *stream, size_t multiProcessorCount, size_t maxThreadsPerBlock)
```

Create an asynchronous stream.

**See also:**

topsStreamSynchronize, topsStreamWaitEvent, topsStreamDestroy

**Parameters:**

- **stream** -- **[inout]** Pointer to new stream
- **multiProcessorCount.** -- **[in]**
- **maxThreadsPerBlock.** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidValue

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsStreamGetLaunchLimit(topsStream_t stream, size_t *multiProcessorCount, size_t *maxThreadsPerBlock)
```

Get launch limit.

**See also:**

topsStreamSynchronize, topsStreamWaitEvent, topsStreamDestroy

**Parameters:**

- **stream** -- **[in]** Stream to be queried
- **multiProcessorCount.** -- **[inout]**
- **maxThreadsPerBlock.** -- **[inout]**

**Returns:** topsSuccess, topsErrorInvalidValue

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsStreamSetLaunchLimit(topsStream_t stream, size_t multiProcessorCount, size_t maxThreadsPerBlock)
```

Set launch limit.

**See also:**

topsStreamGetLaunchLimit

**Parameters:**

- **stream** -- **[in]** Stream to be set
- **multiProcessorCount.** -- **[in]**
- **maxThreadsPerBlock.** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidValue

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsStreamDestroy(topsStream_t stream)
```

Destroys the specified stream.

Destroys the specified stream.

If commands are still executing on the specified stream, some may complete execution before the queue is deleted.

The queue may be destroyed while some commands are still inflight, or may wait for all commands queued to the stream before destroying it.

Note: stream resource should be released before process exit

**See also:**

topsStreamCreate, topsStreamQuery, topsStreamWaitEvent, topsStreamSynchronize

**Parameters:** **stream** -- **[in]** stream to destroy

**Returns:** topsSuccess #topsErrorInvalidHandle

```cpp
TOPS_PUBLIC_API topsError_t topsStreamGetId(topsStream_t stream, uint64_t *streamId)
```

Return topsSuccess if query the ld of a stream., or topsErrorNotReady if not.

This is thread-safe and returns a snapshot of the id of the stream.

**See also:**

topsStreamCreate, topsStreamCreateWithFlags, topsStreamDestroy, topsStreamDestroy

**Parameters:**

- **stream** -- **[in]** Stream to be queried
- **streamId** -- **[inout]** Returns the stream id.

**Returns:** topsSuccess, topsErrorNotReady, #topsErrorInvalidHandle

```cpp
TOPS_PUBLIC_API topsError_t topsStreamQuery(topsStream_t stream)
```

Return topsSuccess if all of the operations in the specified `stream` have completed, or topsErrorNotReady if not.

This is thread-safe and returns a snapshot of the current state of the queue. However, if other host threads are sending work to the stream, the status may change immediately after the function is called. It is typically used for debug.

**See also:**

topsStreamCreate, topsStreamWaitEvent, topsStreamSynchronize, topsStreamDestroy

**Parameters:** **stream** -- **[in]** stream to query

**Returns:** topsSuccess, topsErrorNotReady, #topsErrorInvalidHandle

```cpp
TOPS_PUBLIC_API topsError_t topsStreamSynchronize(topsStream_t stream)
```

Wait for all commands in stream to complete.

This command is host-synchronous : the host will block until the specified stream is empty.

This command follows standard null-stream semantics. Specifically, specifying the null stream will cause the command to wait for other streams on the same device to complete all pending operations.

This command honors the topsDeviceLaunchBlocking flag, which controls whether the wait is active or blocking.

**See also:**

topsStreamCreate, topsStreamWaitEvent, topsStreamDestroy

**Parameters:** **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess, #topsErrorInvalidHandle

```cpp
TOPS_PUBLIC_API topsError_t topsStreamWaitEvent(topsStream_t stream, topsEvent_t event, unsigned int flags)
```

Make the specified compute stream wait for an event.

This function inserts a wait operation into the specified stream. All future work submitted to `stream` will wait until `event` reports completion before beginning execution.

This function only waits for commands in the current stream to complete. Notably,, this function does not implicit wait for commands in the default stream to complete, even if the specified stream is created with topsStreamNonBlocking = 0.

**See also:**

topsStreamCreate, topsStreamSynchronize, topsStreamDestroy

**Parameters:**

- **stream** -- **[in]** stream to make wait.
- **event** -- **[in]** event to wait on
- **flags** -- **[in]** control operation [must be 0]

**Returns:** topsSuccess, #topsErrorInvalidHandle

```cpp
TOPS_PUBLIC_API topsError_t topsStreamAddCallback(topsStream_t stream, topsStreamCallback_t callback, void *userData, unsigned int flags)
```

Adds a callback to be called on the host after all currently enqueued items in the stream have completed. For each topsStreamAddCallback call, a callback will be executed exactly once. The callback will block later work in the stream until it is finished.

**See also:**

topsStreamCreate, topsStreamQuery, topsStreamSynchronize, topsStreamWaitEvent, topsStreamDestroy

**Parameters:**

- **stream** -- **[in]** - Stream to add callback to
- **callback** -- **[in]** - The function to call once preceding stream operations are complete
- **userData** -- **[in]** - User specified data to be passed to the callback function
- **flags** -- **[in]** - topsStreamDefault: non-blocking stream execution; topsStreamCallbackBlocking: stream blocks until callback is completed.

**Returns:** topsSuccess, #topsErrorInvalidHandle, topsErrorNotSupported

```cpp
TOPS_PUBLIC_API topsError_t topsStreamWriteValue32(topsDeviceptr_t dst, int value, unsigned int flags)
```

Write a value to local device memory.

**Parameters:**

- **dst** -- **[in]** - The device address to write to.
- **value** -- **[in]** - The value to write.
- **flags** -- **[in]** - Reserved for future expansion; must be 0.

**Returns:** topsSuccess, topsErrorInvalidDevicePointer

```cpp
TOPS_PUBLIC_API topsError_t topsStreamWriteValue32Async(topsDeviceptr_t dst, int value, unsigned int flags, topsStream_t stream __dparm(0))
```

Write a value to local device memory async.

**Parameters:**

- **dst** -- **[in]** - The device address to write to.
- **value** -- **[in]** - The value to compare with the memory location.
- **flags** -- **[in]** - Reserved for future expansion; must be 0.
- **stream** -- **[in]** - The stream to synchronize on the memory location.

**Returns:** topsSuccess, topsErrorInvalidDevicePointer

```cpp
TOPS_PUBLIC_API topsError_t topsStreamWaitValue32(topsDeviceptr_t dst, int value, unsigned int flags)
```

Wait on a memory location.

**Parameters:**

- **dst** -- **[in]** - The memory location to wait on.
- **value** -- **[in]** - The value to compare with the memory location.
- **flags** -- **[in]** - Reserved for future expansion; must be 0.

**Returns:** topsSuccess, topsErrorInvalidDevicePointer

```cpp
TOPS_PUBLIC_API topsError_t topsStreamWaitValue32Async(topsDeviceptr_t dst, int value, unsigned int flags, topsStream_t stream __dparm(0))
```

Wait on a memory location async.

**Parameters:**

- **dst** -- **[in]** - The memory location to wait on.
- **value** -- **[in]** - The value to compare with the memory location.
- **flags** -- **[in]** - Reserved for future expansion; must be 0.
- **stream** -- **[in]** - The stream to synchronize on the memory location.

**Returns:** topsSuccess, topsErrorInvalidDevicePointer

```cpp
TOPS_PUBLIC_API topsError_t topsMallocAsync(void **dev_ptr, size_t size, topsStream_t stream, uint64_t flags)
```

Allocates memory with stream ordered semantics.

Inserts a memory allocation operation into `stream`. A pointer to the allocated memory is returned immediately in *dptr. The allocation must not be accessed until the the allocation operation completes. The allocation comes from the memory pool associated with the stream's device.

**See also:**

topsMallocFromPoolAsync, topsFreeAsync, topsMemPoolTrimTo, topsMemPoolGetAttribute, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

The default memory pool of a device contains device memory from that device.

**Note:**

Basic stream ordering allows future work submitted into the same stream to use the allocation. Stream query, stream synchronize, and TOPS events can be used to guarantee that the allocation operation completes before work submitted in a separate stream runs.

**Note:**

During stream capture, this function results in the creation of an allocation node. In this case, the allocation is owned by the graph instead of the memory pool. The memory pool's properties are used to set the node's creation parameters.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **dev_ptr** -- **[out]** Returned device pointer of memory allocation
- **size** -- **[in]** Number of bytes to allocate
- **stream** -- **[in]** The stream establishing the stream ordering contract and the memory pool to allocate from
- **flags** -- **[in]** Flags to control allocation. [63:56] Memory bank for affinity. [55:0] flags to control allocation.

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorNotSupported, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsFreeAsync(void *dev_ptr, topsStream_t stream)
```

Frees memory with stream ordered semantics.

Inserts a free operation into `stream`. The allocation must not be used after stream execution reaches the free. After this API returns, accessing the memory from any subsequent work launched on the GPU or querying its pointer attributes results in undefined behavior.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsMemPoolTrimTo, topsMemPoolGetAttribute, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

During stream capture, this function results in the creation of a free node and must therefore be passed the address of a graph allocation.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **dev_ptr** -- **[in]** Pointer to device memory to free
- **stream** -- **[in]** The stream, where the destruction will occur according to the execution order

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorNotSupported

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolTrimTo(topsMemPool_t mem_pool, size_t min_bytes_to_hold)
```

Releases freed memory back to the OS.

Releases memory back to the OS until the pool contains fewer than `min_bytes_to_keep` reserved bytes, or there is no more memory that the allocator can safely release. The allocator cannot release OS allocations that back outstanding asynchronous allocations. The OS allocations may happen at different granularity from the user allocations.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

Allocations that have not been freed count as outstanding.

**Note:**

Allocations that have been asynchronously freed but whose completion has not been observed on the host (eg. by a synchronize) can count as outstanding.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[in]** The memory pool to trim allocations
- **min_bytes_to_hold** -- **[in]** If the pool has less than min_bytes_to_hold reserved, then the TrimTo operation is a no-op. Otherwise the memory pool will contain at least min_bytes_to_hold bytes reserved after the operation.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolSetAttribute(topsMemPool_t mem_pool, topsMemPoolAttr attr, void *value)
```

Sets attributes of a memory pool.

Supported attributes are:

- `topsMemPoolAttrReleaseThreshold:` (value type = cuuint64_t) Amount of reserved memory in bytes to hold onto before trying to release memory back to the OS. When more than the release threshold bytes of memory are held by the memory pool, the allocator will try to release memory back to the OS on the next call to stream, event or context synchronize. (default 0)
- `topsMemPoolReuseFollowEventDependencies:` (value type = int) Allow `topsMallocAsync` to use memory asynchronously freed in another stream as long as a stream ordering dependency of the allocating stream on the free action exists. TOPS events and null stream interactions can create the required stream ordered dependencies. (default enabled)
- `topsMemPoolReuseAllowOpportunistic:` (value type = int) Allow reuse of already completed frees when there is no dependency between the free and allocation. (default enabled)
- `topsMemPoolReuseAllowInternalDependencies:` (value type = int) Allow `topsMallocAsync` to insert new stream dependencies in order to establish the stream ordering required to reuse a piece of memory released by `topsFreeAsync` (default enabled).

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[in]** The memory pool to modify
- **attr** -- **[in]** The attribute to modify
- **value** -- **[in]** Pointer to the value to assign

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolGetAttribute(topsMemPool_t mem_pool, topsMemPoolAttr attr, void *value)
```

Gets attributes of a memory pool.

Supported attributes are:

- `topsMemPoolAttrReleaseThreshold:` (value type = cuuint64_t) Amount of reserved memory in bytes to hold onto before trying to release memory back to the OS. When more than the release threshold bytes of memory are held by the memory pool, the allocator will try to release memory back to the OS on the next call to stream, event or context synchronize. (default 0)
- `topsMemPoolReuseFollowEventDependencies:` (value type = int) Allow `topsMallocAsync` to use memory asynchronously freed in another stream as long as a stream ordering dependency of the allocating stream on the free action exists. TOPS events and null stream interactions can create the required stream ordered dependencies. (default enabled)
- `topsMemPoolReuseAllowOpportunistic:` (value type = int) Allow reuse of already completed frees when there is no dependency between the free and allocation. (default enabled)
- `topsMemPoolReuseAllowInternalDependencies:` (value type = int) Allow `topsMallocAsync` to insert new stream dependencies in order to establish the stream ordering required to reuse a piece of memory released by `topsFreeAsync` (default enabled).

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[in]** The memory pool to get attributes of
- **attr** -- **[in]** The attribute to get
- **value** -- **[in]** Retrieved value

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolSetAccess(topsMemPool_t mem_pool, const topsMemAccessDesc *desc_list, size_t count)
```

Controls visibility of the specified pool between devices.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolGetAccess

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[in]** Memory pool for access change
- **desc_list** -- **[in]** Array of access descriptors. Each descriptor instructs the access to enable for a single gpu
- **count** -- **[in]** Number of descriptors in the map array.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolGetAccess(topsMemAccessFlags *flags, topsMemPool_t mem_pool, topsMemLocation *location)
```

Returns the accessibility of a pool from a device.

Returns the accessibility of the pool's memory from the specified location.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **flags** -- **[out]** Accessibility of the memory pool from the specified location/device
- **mem_pool** -- **[in]** Memory pool being queried
- **location** -- **[in]** Location/device for memory pool access

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolCreate(topsMemPool_t *mem_pool, const topsMemPoolProps *pool_props)
```

Creates a memory pool.

Creates a TOPS memory pool and returns the handle in `mem_pool`. The `pool_props` determines the properties of the pool such as the backing device and IPC capabilities.

By default, the memory pool will be accessible from the device it is allocated on.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolDestroy, topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

Specifying topsMemHandleTypeNone creates a memory pool that will not support IPC.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[out]** Contains created memory pool
- **pool_props** -- **[in]** Memory pool properties

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorNotSupported

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGetDefaultMemPool(topsMemPool_t *mem_pool, int device)
```

Gets the default memory pool for a specific device.

This function retrieves the default TOPS memory pool for a specified device. The memory pool is identified by the handle returned in `mem_pool`, and the device is specified by the device ID in `device`.

By retrieving the default memory pool for a device, users can manage memory allocations on that device more efficiently, leveraging the properties and capabilities defined in the memory pool.

**See also:**

topsDeviceSetMemPool, topsMemPoolCreate, topsMemPoolDestroy, topsMemPoolGetAttribute, topsMemPoolSetAttribute

**Note:**

The default memory pool is automatically created and managed by the TOPS runtime.

**Note:**

This API is implemented on Linux, and is under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[out]** Pointer to the memory pool handle where the default memory pool will be stored
- **device** -- **[in]** Device ID for which the default memory pool is to be retrieved

**Returns:** topsSuccess if the default memory pool was successfully retrieved for the device. topsErrorInvalidValue if the provided device ID is invalid or if mem_pool is a null pointer.

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceSetMemPool(int device, topsMemPool_t mem_pool)
```

Sets a memory pool for a specific device.

This function sets a previously created TOPS memory pool for a specified device. The memory pool is identified by the handle in `mem_pool`, and the device is specified by the device ID in `device`.

By setting a memory pool for a device, memory allocations on that device can be managed more efficiently, leveraging the properties and capabilities defined in the memory pool.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolDestroy, topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

This API is implemented on Linux, and is under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **device** -- **[in]** Device ID for which the memory pool is to be set
- **mem_pool** -- **[in]** Handle to the memory pool to be set for the device

**Returns:** topsSuccess if the memory pool was successfully set for the device. topsErrorInvalidValue if the provided memory pool handle or device ID is invalid. topsErrorNotSupported if the operation is not supported on the current platform.

```cpp
TOPS_PUBLIC_API topsError_t topsThreadSetMemPool(topsMemPool_t mem_pool)
```

Sets a memory pool to the calling CPU thread.

This function sets a previously created TOPS memory pool to the calling CPU thread. The memory pool is identified by the handle in `mem_pool`.

By setting a memory pool for calling CPU thread, memory allocations on that thread can be managed more efficiently, leveraging the properties and capabilities defined in the memory pool.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolDestroy, topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

This API is implemented on Linux, and is under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:** **mem_pool** -- **[in]** Handle to the memory pool to be set for calling CPU thread

**Returns:** topsSuccess if the memory pool was successfully set for calling CPU thread. topsErrorNotSupported if the operation is not supported on the current platform.

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGetMemPool(topsMemPool_t *mem_pool, int device)
```

Gets the memory pool for a specific device.

This function retrieves the TOPS memory pool associated with a specified device. The memory pool is identified by the handle returned in `mem_pool`, and the device is specified by the device ID in `device`.

By retrieving the memory pool for a device, users can manage memory allocations on that device more efficiently, leveraging the properties and capabilities defined in the memory pool.

**See also:**

topsDeviceSetMemPool, topsMemPoolCreate, topsMemPoolDestroy, topsMemPoolGetAttribute, topsMemPoolSetAttribute

**Note:**

The memory pool must have been previously set for the device using topsDeviceSetMemPool.

**Note:**

This API is implemented on Linux, and is under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[out]** Pointer to the memory pool handle where the memory pool will be stored
- **device** -- **[in]** Device ID for which the memory pool is to be retrieved

**Returns:** topsSuccess if the memory pool was successfully retrieved for the device. topsErrorInvalidValue if the provided device ID is invalid or if mem_pool is a null pointer.

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolDestroy(topsMemPool_t mem_pool)
```

Destroys the specified memory pool.

If any pointers obtained from this pool haven't been freed or the pool has free operations that haven't completed when `topsMemPoolDestroy` is invoked, the function will return immediately and the resources associated with the pool will be released automatically once there are no more outstanding allocations.

Destroying the current mempool of a device sets the default mempool of that device as the current mempool for that device.

**See also:**

topsMallocFromPoolAsync, topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolCreate topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess

**Note:**

A device's default memory pool cannot be destroyed.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:** **mem_pool** -- **[in]** Memory pool for destruction

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMallocFromPoolAsync(void **dev_ptr, size_t size, topsMemPool_t mem_pool, topsStream_t stream)
```

Allocates memory from a specified pool with stream ordered semantics.

Inserts an allocation operation into `stream`. A pointer to the allocated memory is returned immediately in `dev_ptr`. The allocation must not be accessed until the the allocation operation completes. The allocation comes from the specified memory pool.

Basic stream ordering allows future work submitted into the same stream to use the allocation. Stream query, stream synchronize, and TOPS events can be used to guarantee that the allocation operation completes before work submitted in a separate stream runs.

**See also:**

topsMallocAsync, topsFreeAsync, topsMemPoolGetAttribute, topsMemPoolCreate topsMemPoolTrimTo, topsDeviceSetMemPool, topsMemPoolSetAttribute, topsMemPoolSetAccess, topsMemPoolGetAccess,

**Note:**

The specified memory pool may be from a device different than that of the specified `stream`.

**Note:**

During stream capture, this function results in the creation of an allocation node. In this case, the allocation is owned by the graph instead of the memory pool. The memory pool's properties are used to set the node's creation parameters.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **dev_ptr** -- **[out]** Returned device pointer
- **size** -- **[in]** Number of bytes to allocate
- **mem_pool** -- **[in]** The pool to allocate from
- **stream** -- **[in]** The stream establishing the stream ordering semantic

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorNotSupported, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolExportToShareableHandle(void *shared_handle, topsMemPool_t mem_pool, topsMemAllocationHandleType handle_type, unsigned int flags)
```

Exports a memory pool to the requested handle type.

Given an IPC capable mempool, create an OS handle to share the pool with another process. A recipient process can convert the shareable handle into a mempool with `topsMemPoolImportFromShareableHandle`. Individual pointers can then be shared with the `topsMemPoolExportPointer` and `topsMemPoolImportPointer` APIs. The implementation of what the shareable handle is and how it can be transferred is defined by the requested handle type.

**See also:**

topsMemPoolImportFromShareableHandle

**Note:**

To create an IPC capable mempool, create a mempool with a `topsMemAllocationHandleType` other than `topsMemHandleTypeNone`.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **shared_handle** -- **[out]** Pointer to the location in which to store the requested handle
- **mem_pool** -- **[in]** Pool to export
- **handle_type** -- **[in]** The type of handle to create
- **flags** -- **[in]** Must be 0

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolImportFromShareableHandle(topsMemPool_t *mem_pool, void *shared_handle, topsMemAllocationHandleType handle_type, unsigned int flags)
```

Imports a memory pool from a shared handle.

Specific allocations can be imported from the imported pool with `topsMemPoolImportPointer`.

**See also:**

topsMemPoolExportToShareableHandle

**Note:**

Imported memory pools do not support creating new allocations. As such imported memory pools may not be used in `topsDeviceSetMemPool` or `topsMallocFromPoolAsync` calls.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **mem_pool** -- **[out]** Returned memory pool
- **shared_handle** -- **[in]** OS handle of the pool to open
- **handle_type** -- **[in]** The type of handle being imported
- **flags** -- **[in]** Must be 0

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolExportPointer(topsMemPoolPtrExportData *export_data, void *dev_ptr)
```

Export data to share a memory pool allocation between processes.

Constructs `export_data` for sharing a specific allocation from an already shared memory pool. The recipient process can import the allocation with the `topsMemPoolImportPointer` api. The data is not a handle and may be shared through any IPC mechanism.

**See also:**

topsMemPoolImportPointer

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **export_data** -- **[out]** Returned export data
- **dev_ptr** -- **[in]** Pointer to memory being exported

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsMemPoolImportPointer(void **dev_ptr, topsMemPool_t mem_pool, topsMemPoolPtrExportData *export_data)
```

Import a memory pool allocation from another process.

Returns in `dev_ptr` a pointer to the imported memory. The imported memory must not be accessed before the allocation operation completes in the exporting process. The imported memory must be freed from all importing processes before being freed in the exporting process. The pointer may be freed with `topsFree` or `topsFreeAsync`. If `topsFreeAsync` is used, the free must be completed on the importing process before the free operation on the exporting process.

**See also:**

topsMemPoolExportPointer

**Note:**

The `topsFreeAsync` api may be used in the exporting process before the `topsFreeAsync` operation completes in its stream as long as the `topsFreeAsync` in the exporting process specifies a stream with a stream dependency on the importing process's `topsFreeAsync`.

**Note:**

This API is implemented on Linux, under development on Windows.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **dev_ptr** -- **[out]** Pointer to imported memory
- **mem_pool** -- **[in]** Memory pool from which to import a pointer
- **export_data** -- **[in]** Data specifying the memory to import

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized, #topsErrorOutOfMemory

### 2.5. Event

This section describes the event management functions of TOPS runtime API.

```cpp
TOPS_PUBLIC_API topsError_t topsEventCreateWithFlags(topsEvent_t *event, unsigned flags)
```

Create an event object with the specified flags.

Creates an event object for the current device with the specified flags. Valid values include:

- topsEventDefault: Default event create flag. The event will use active synchronization and will support timing. Blocking synchronization provides lowest possible latency at the expense of dedicating a CPU to poll on the event.
- topsEventBlockingSync: Specifies that event should use blocking synchronization. A host thread that uses topsEventSynchronize() to wait on an event created with this flag will block until the event actually completes.
- topsEventDisableTiming: Specifies that the created event does not need to record timing data. Events created with this flag specified and the topsEventBlockingSync flag not specified will provide the best performance when used with topsStreamWaitEvent() and topsEventQuery().
- topsEventInterprocess: Specifies that the created event may be used as an interprocess event by topsIpcGetEventHandle(). topsEventInterprocess must be specified along with topsEventDisableTiming.

**See also:**

topsEventCreate, topsEventSynchronize, topsEventDestroy, topsEventElapsedTime

**Note:**

- Note that this function may also return error codes from previous, asynchronous launches.

**Parameters:**

- **event** -- **[inout]** Returns the newly created event.
- **flags** -- **[in]** Flags to control event behavior.

**Returns:** topsSuccess, #topsErrorNotInitialized, topsErrorInvalidValue, topsErrorLaunchFailure, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsEventCreate(topsEvent_t *event)
```

Create an event object.

Creates an event object for the current device using topsEventDefault.

**See also:**

topsEventRecord, topsEventQuery, topsEventSynchronize, topsEventDestroy, topsEventElapsedTime

**Parameters:** **event** -- **[inout]** Returns the newly created event.

**Returns:** topsSuccess, #topsErrorNotInitialized, topsErrorInvalidValue, topsErrorLaunchFailure, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsEventRecord(topsEvent_t event, topsStream_t stream)
```

Record an event in the specified stream.

Captures in event the contents of stream at the time of this call. event and stream must be on the same TOPS context. Calls such as topsEventQuery() or topsStreamWaitEvent() will then examine or wait for completion of the work that was captured. Uses of stream after this call do not modify event.

topsEventRecord() can be called multiple times on the same event and will overwrite the previously captured state. Other APIs such as topsStreamWaitEvent() use the most recently captured state at the time of the API call, and are not affected by later calls to topsEventRecord(). Before the first call to topsEventRecord(), an event represents an empty set of work, so for example topsEventQuery() would return topsSuccess.

topsEventQuery() or topsEventSynchronize() must be used to determine when the event transitions from "recording" (after topsEventRecord() is called) to "recorded" (when timestamps are set, if requested).

Events which are recorded in a non-NULL stream will transition from "recording" to "recorded" state when they reach the head of the specified stream, after all previous commands in that stream have completed executing.

If topsEventRecord() has been previously called on this event, then this call will overwrite any existing state in event.

If this function is called on an event that is currently being recorded, results are undefined

- either outstanding recording may save state into the event, and the order is not guaranteed.

**See also:**

topsEventCreate, topsEventQuery, topsEventSynchronize, topsEventDestroy, topsEventElapsedTime

**Parameters:**

- **event** -- **[in]** event to record.
- **stream** -- **[in]** stream in which to record event.

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized, #topsErrorInvalidHandle, topsErrorLaunchFailure

```cpp
TOPS_PUBLIC_API topsError_t topsEventDestroy(topsEvent_t event)
```

Destroy the specified event.

Releases memory associated with the event. An event may be destroyed before it is complete (i.e., while topsEventQuery() would return topsErrorNotReady). If the event is recording but has not completed recording when topsEventDestroy() is called, the function will return immediately and any associated resources will automatically be released asynchronously at completion.

**See also:**

topsEventCreate, topsEventQuery, topsEventSynchronize, topsEventRecord, topsEventElapsedTime

**Note:**

Use of the handle after this call is undefined behavior.

**Parameters:** **event** -- **[in]** Event to destroy.

**Returns:** topsSuccess, #topsErrorNotInitialized, topsErrorInvalidValue, topsErrorLaunchFailure

```cpp
TOPS_PUBLIC_API topsError_t topsEventSynchronize(topsEvent_t event)
```

Wait for an event to complete.

This function will block until the event is ready, waiting for all previous work in the stream specified when event was recorded with topsEventRecord().

If topsEventRecord() has not been called on `event`, this function returns immediately.

Note:This function needs to support topsEventBlockingSync parameter.

**See also:**

topsEventCreate, topsEventQuery, topsEventDestroy, topsEventRecord, topsEventElapsedTime

**Parameters:** **event** -- **[in]** Event on which to wait.

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized, #topsErrorInvalidHandle, topsErrorLaunchFailure

```cpp
TOPS_PUBLIC_API topsError_t topsEventElapsedTime(float *ms, topsEvent_t start, topsEvent_t stop)
```

Return the elapsed time between two events.

Computes the elapsed time between two events. Time is computed in ms, with a resolution of approximately 1 us.

Events which are recorded in a NULL stream will block until all commands on all other streams complete execution, and then record the timestamp.

Events which are recorded in a non-NULL stream will record their timestamp when they reach the head of the specified stream, after all previous commands in that stream have completed executing. Thus the time that the event recorded may be significantly after the host calls topsEventRecord().

If topsEventRecord() has not been called on either event, then #topsErrorInvalidHandle is returned. If topsEventRecord() has been called on both events, but the timestamp has not yet been recorded on one or both events (that is, topsEventQuery() would return topsErrorNotReady on at least one of the events), then topsErrorNotReady is returned.

Note, for TOPS Events used in kernel dispatch using topsExtLaunchKernelGGL/topsExtLaunchKernel, events passed in topsExtLaunchKernelGGL/topsExtLaunchKernel are not explicitly recorded and should only be used to get elapsed time for that specific launch. In case events are used across multiple dispatches, for example, start and stop events from different topsExtLaunchKernelGGL/ topsExtLaunchKernel calls, they will be treated as invalid unrecorded events, TOPS will throw error "topsErrorInvalidHandle" from topsEventElapsedTime.

**See also:**

topsEventCreate, topsEventQuery, topsEventDestroy, topsEventRecord, topsEventSynchronize

**Parameters:**

- **ms** -- **[out]** : Return time between start and stop in ms.
- **start** -- **[in]** : Start event.
- **stop** -- **[in]** : Stop event.

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorNotReady, #topsErrorInvalidHandle, #topsErrorNotInitialized, topsErrorLaunchFailure

```cpp
TOPS_PUBLIC_API topsError_t topsEventQuery(topsEvent_t event)
```

Query event status.

Query the status of the specified event. This function will return topsErrorNotReady if all commands in the appropriate stream (specified to topsEventRecord()) have completed. If that work has not completed, or if topsEventRecord() was not called on the event, then topsSuccess is returned.

**See also:**

topsEventCreate, topsEventRecord, topsEventDestroy, topsEventSynchronize, topsEventElapsedTime

**Parameters:** **event** -- **[in]** Event to query.

**Returns:** topsSuccess, topsErrorNotReady, #topsErrorInvalidHandle, topsErrorInvalidValue, #topsErrorNotInitialized, topsErrorLaunchFailure

### 2.6. Memory

This section describes the memory management functions of TOPS runtime API.

```cpp
TOPS_PUBLIC_API topsError_t topsPointerGetAttributes(topsPointerAttribute_t *attributes, const void *ptr)
```

Return attributes for the specified pointer.

**See also:**

topsPointerGetAttribute

**Parameters:**

- **attributes** -- **[out]** attributes for the specified pointer
- **ptr** -- **[in]** pointer to get attributes for

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsPointerGetAttribute(void *data, topsPointer_attribute attribute, topsDeviceptr_t ptr)
```

Returns information about the specified pointer.

**See also:**

topsPointerGetAttributes

**Parameters:**

- **data** -- **[inout]** returned pointer attribute value
- **attribute** -- **[in]** attribute to query for
- **ptr** -- **[in]** pointer to get attributes for

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsPointerGetDevicePointer(void **devPtr, topsDeviceptr_t *ptr, size_t count)
```

Returns device pointer about the specified pointers.

**See also:**

topsPointerGetAttributes

**Parameters:**

- **devPtr** -- **[inout]** returned device pointers
- **ptr** -- **[in]** pointers to get devPtr for
- **count** -- **[in]** number of pointers to query

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDrvPointerGetAttributes(unsigned int numAttributes, topsPointer_attribute *attributes, void **data, topsDeviceptr_t ptr)
```

Returns information about the specified pointer.

**See also:**

topsPointerGetAttribute

**Parameters:**

- **numAttributes** -- **[in]** number of attributes to query for
- **attributes** -- **[in]** attributes to query for
- **data** -- **[inout]** a two-dimensional containing pointers to memory locations where the result of each attribute query will be written to
- **ptr** -- **[in]** pointer to get attributes for

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMalloc(void **ptr, size_t size)
```

Allocate memory on the default accelerator.

If size is 0, no memory is allocated, *ptr returns non-nullptr, and topsSuccess is returned.

**See also:**

topsFree, topsHostFree, topsHostMalloc

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated memory
- **size** -- **[in]** Requested memory size

**Returns:** topsSuccess, #topsErrorOutOfMemory, topsErrorInvalidValue (bad context, null *ptr)

```cpp
TOPS_PUBLIC_API topsError_t topsExtCodecMemHandle(void **pointer, uint64_t dev_addr, size_t size)
```

convert device memory to efcodec memory handle

If size is 0, no memory is allocated, *ptr returns non-nullptr, and topsSuccess is returned.

**See also:**

topsFree, topsHostFree, topsHostMalloc

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated memory handle
- **dev_addr** -- **[in]** Requested memory device address
- **size** -- **[in]** Requested memory size

**Returns:** topsSuccess, #topsErrorOutOfMemory, topsErrorInvalidValue (bad context, null *ptr)

```cpp
TOPS_PUBLIC_API topsError_t topsExtMallocWithFlags(void **ptr, size_t sizeBytes, unsigned int flags)
```

Allocate memory on the default accelerator.

If size is 0, no memory is allocated, *ptr returns non-nullptr, and topsSuccess is returned.

**See also:**

topsFree, topsHostFree, topsHostMalloc

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated memory
- **sizeBytes** -- **[in]** Requested memory size
- **flags** -- **[in]** Type of memory allocation flags only support topsDeviceMallocDefault/topsMallocTopDown/ topsMallocForbidMergeMove/topsMallocPreferHighSpeedMem

**Returns:** topsSuccess, #topsErrorOutOfMemory, topsErrorInvalidValue (bad context, null *ptr)

```cpp
TOPS_PUBLIC_API topsError_t topsMallocManaged(void **ptr, size_t sizeBytes, unsigned int flags)
```

Allocate Unified Virtual Memory.

If size is 0, no memory is allocated, *ptr returns nullptr, and topsSuccess is returned. On devices without UVM support, topsErrorOutOfMemory is returned.

**See also:**

topsFree

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated uvm
- **sizeBytes** -- **[in]** Requested memory size
- **flags** -- **[in]** No used so far, set to 0 by default.

**Returns:** topsSuccess, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsHostMalloc(void **ptr, size_t size, unsigned int flags)
```

Allocate device accessible page locked host memory.

If size is 0, no memory is allocated, *ptr returns nullptr, and topsSuccess is returned.

**See also:**

topsSetDeviceFlags, topsHostFree

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated host pinned memory
- **size** -- **[in]** Requested memory size
- **flags** -- **[in]** Type of host memory allocation

**Returns:** topsSuccess, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsHostGetDevicePointer(void **devPtr, void *hostPtr, unsigned int flags)
```

Get Device pointer from Host Pointer allocated through topsHostMalloc.

**See also:**

topsSetDeviceFlags, topsHostMalloc

**Parameters:**

- **devPtr** -- **[out]** Device Pointer mapped to passed host pointer
- **hostPtr** -- **[in]** Host Pointer allocated through topsHostMalloc
- **flags** -- **[in]** Flags to be passed for extension

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsHostGetFlags(unsigned int *flagsPtr, void *hostPtr)
```

Return flags associated with host pointer.

**See also:**

topsHostMalloc

**Parameters:**

- **flagsPtr** -- **[out]** Memory location to store flags
- **hostPtr** -- **[in]** Host Pointer allocated through topsHostMalloc

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsHostRegister(void *hostPtr, size_t sizeBytes, unsigned int flags)
```

Register host memory so it can be accessed from the current device.

Flags:

- topsHostRegisterDefault Memory is Mapped but not Portable
- topsHostRegisterPortable Memory is considered registered by all contexts.
- topsHostRegisterMapped Map the allocation into the address space for the current device. The device pointer can be obtained with topsHostGetDevicePointer.
- topsHostRegisterIoMemory Memory is memory-mapped IO memory.

After registering the memory, use topsHostGetDevicePointer to obtain the mapped device pointer. On many systems, the mapped device pointer will have a different value than the mapped host pointer. Applications must use the device pointer in device code, and the host pointer in device code.

On some systems, registered memory is pinned. On some systems, registered memory may not be actually be pinned but uses OS or hardware facilities to all GCU access to the host memory.

Developers are strongly encouraged to register memory blocks which are aligned to the host cache-line size. (typically 64-bytes but can be obtains from the CPUID instruction).

If registering non-aligned pointers, the application must take care when register pointers from the same cache line on different devices. TOPS's coarse-grained synchronization model does not guarantee correct results if different devices write to different parts of the same cache block - typically one of the writes will "win" and overwrite data from the other registered memory region.

**See also:**

topsHostUnregister, topsHostGetFlags, topsHostGetDevicePointer

**Parameters:**

- **hostPtr** -- **[out]** Pointer to host memory to be registered.
- **sizeBytes** -- **[in]** size of the host memory
- **flags.** -- **[in]** See below.

**Returns:** topsSuccess, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsHostUnregister(void *hostPtr)
```

Un-register host pointer.

**See also:**

topsHostRegister

**Parameters:** **hostPtr** -- **[in]** Host pointer previously registered with topsHostRegister

**Returns:** Error code

```cpp
TOPS_PUBLIC_API topsError_t topsFree(void *ptr)
```

Free memory allocated by the tops memory allocation API. This API performs an implicit topsDeviceSynchronize() call. If pointer is NULL, the tops runtime is initialized and topsSuccess is returned.

**See also:**

topsMalloc, topsHostFree, topsHostMalloc

**Parameters:** **ptr** -- **[in]** Pointer to memory to be freed

**Returns:** topsSuccess

**Returns:** topsErrorInvalidDevicePointer (if pointer is invalid, including host pointers allocated with topsHostMalloc)

```cpp
TOPS_PUBLIC_API topsError_t topsHostFree(void *ptr)
```

Free memory allocated by the tops host memory allocation API This API performs an implicit topsDeviceSynchronize() call. If pointer is NULL, the tops runtime is initialized and topsSuccess is returned.

**See also:**

topsMalloc, topsFree, topsHostMalloc

**Parameters:** **ptr** -- **[in]** Pointer to memory to be freed

**Returns:** topsSuccess, topsErrorInvalidValue (if pointer is invalid, including device pointers allocated with topsMalloc)

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpy(void *dst, const void *src, size_t sizeBytes, topsMemcpyKind kind)
```

Copy data from src to dst.

It supports memory from host to device, device to host, device to device and host to host The src and dst must not overlap.

For topsMemcpy, the copy is always performed by the current device (set by topsSetDevice). For multi-gcu or peer-to-peer configurations, it is recommended to set the current device to the device where the src data is physically located. For optimal peer-to-peer copies, the copy device must be able to access the src and dst pointers (by calling topsDeviceEnablePeerAccess with copy agent as the current device and src/dest as the peerDevice argument. if this is not done, the topsMemcpy will still work, but will perform the copy using a staging buffer on the host. Calling topsMemcpy with dst and src pointers that do not match the topsMemcpyKind results in undefined behavior.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoDAsync, topsMemcpyDtoH, topsMemcpyDtoHAsync, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes
- **kind** -- **[in]** Memory copy type

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree, #topsErrorUnknown

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyWithStream(void *dst, const void *src, size_t sizeBytes, topsMemcpyKind kind, topsStream_t stream)
```

Copy data from src to dst.

It supports memory from host to device, device to host, device to device and host to host The src and dst must not overlap.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoDAsync, topsMemcpyDtoH, topsMemcpyDtoHAsync, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes
- **kind** -- **[in]** Memory copy type
- **stream** -- **[in]** Stream to enqueue this operation.

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree, #topsErrorUnknown

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyHtoD(topsDeviceptr_t dst, void *src, size_t sizeBytes)
```

Copy data from Host to Device.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoDAsync, topsMemcpyDtoH, topsMemcpyDtoHAsync, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes

**Returns:** topsSuccess, #topsErrorDeInitialized, #topsErrorNotInitialized, topsErrorInvalidContext, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyDtoH(void *dst, topsDeviceptr_t src, size_t sizeBytes)
```

Copy data from Device to Host.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoDAsync, topsMemcpyDtoHAsync, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes

**Returns:** topsSuccess, #topsErrorDeInitialized, #topsErrorNotInitialized, topsErrorInvalidContext, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyDtoD(topsDeviceptr_t dst, topsDeviceptr_t src, size_t sizeBytes)
```

Copy data from Device to Device.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoDAsync, topsMemcpyDtoH, topsMemcpyDtoHAsync, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes

**Returns:** topsSuccess, #topsErrorDeInitialized, #topsErrorNotInitialized, topsErrorInvalidContext, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyHtoDAsync(topsDeviceptr_t dst, void *src, size_t sizeBytes, topsStream_t stream)
```

Copy data from Host to Device asynchronously.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoDAsync, topsMemcpyDtoH, topsMemcpyDtoHAsync, topsMemcpyHtoD

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes
- **stream** -- **[in]** Stream to enqueue this operation.

**Returns:** topsSuccess, #topsErrorDeInitialized, #topsErrorNotInitialized, topsErrorInvalidContext, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyDtoHAsync(void *dst, topsDeviceptr_t src, size_t sizeBytes, topsStream_t stream)
```

Copy data from Device to Host asynchronously.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoDAsync, topsMemcpyDtoH, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes
- **stream** -- **[in]** Stream to enqueue this operation.

**Returns:** topsSuccess, #topsErrorDeInitialized, #topsErrorNotInitialized, topsErrorInvalidContext, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyDtoDAsync(topsDeviceptr_t dst, topsDeviceptr_t src, size_t sizeBytes, topsStream_t stream)
```

Copy data from Device to Device asynchronously.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoH, topsMemcpyDtoHAsync, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes
- **stream** -- **[in]** Stream to enqueue this operation.

**Returns:** topsSuccess, #topsErrorDeInitialized, #topsErrorNotInitialized, topsErrorInvalidContext, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsModuleGetGlobal(topsDeviceptr_t *dptr, size_t *bytes, topsModule_t hmod, const char *name)
```

Returns a global pointer from a module. Returns in *dptr and *bytes the pointer and size of the global symbol located in module hmod. If no variable of that name exists, it returns topsErrorNotFound. Both parameters dptr and bytes are optional. If one of them is NULL, it is ignored and topsSuccess is returned.

**Parameters:**

- **dptr** -- **[out]** Returns global device pointer
- **bytes** -- **[out]** Returns global size in bytes
- **hmod** -- **[in]** Module to retrieve global from
- **name** -- **[in]** Name of global to retrieve

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotFound, topsErrorInvalidContext

```cpp
TOPS_PUBLIC_API topsError_t topsGetSymbolAddress(void **devPtr, const void *symbol)
```

Gets device pointer associated with symbol on the device.

**Parameters:**

- **devPtr** -- **[out]** pointer to the device associated the symbol
- **symbol** -- **[in]** pointer to the symbol of the device

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGetSymbolSize(size_t *size, const void *symbol)
```

Gets the size of the given symbol on the device.

**Parameters:**

- **symbol** -- **[in]** pointer to the device symbol
- **size** -- **[out]** pointer to the size

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyToSymbol(const void *symbol, const void *src, size_t sizeBytes, size_t offset __dparm(0), topsMemcpyKind kind __dparm(topsMemcpyHostToDevice))
```

Copies data to the given symbol on the device. Symbol TOPS APIs allow a kernel to define a device-side data symbol which can be accessed on the host side. The symbol can be in __constant or device space. Note that the symbol name needs to be encased in the TOPS_SYMBOL macro. This also applies to topsMemcpyFromSymbol, topsGetSymbolAddress, and topsGetSymbolSize.

**Parameters:**

- **symbol** -- **[out]** pointer to the device symbol
- **src** -- **[in]** pointer to the source address
- **sizeBytes** -- **[in]** size in bytes to copy
- **offset** -- **[in]** offset in bytes from start of symbol
- **kind** -- **[in]** type of memory transfer

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyToSymbolAsync(const void *symbol, const void *src, size_t sizeBytes, size_t offset, topsMemcpyKind kind, topsStream_t stream __dparm(0))
```

Copies data to the given symbol on the device asynchronously.

**Parameters:**

- **symbol** -- **[out]** pointer to the device symbol
- **src** -- **[in]** pointer to the source address
- **sizeBytes** -- **[in]** size in bytes to copy
- **offset** -- **[in]** offset in bytes from start of symbol
- **kind** -- **[in]** type of memory transfer
- **stream** -- **[in]** stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyFromSymbol(void *dst, const void *symbol, size_t sizeBytes, size_t offset __dparm(0), topsMemcpyKind kind __dparm(topsMemcpyDeviceToHost))
```

Copies data from the given symbol on the device.

**Parameters:**

- **dptr** -- **[out]** Returns pointer to destination memory address
- **symbol** -- **[in]** pointer to the symbol address on the device
- **sizeBytes** -- **[in]** size in bytes to copy
- **offset** -- **[in]** offset in bytes from the start of symbol
- **kind** -- **[in]** type of memory transfer

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyFromSymbolAsync(void *dst, const void *symbol, size_t sizeBytes, size_t offset, topsMemcpyKind kind, topsStream_t stream __dparm(0))
```

Copies data from the given symbol on the device asynchronously.

**Parameters:**

- **dptr** -- **[out]** Returns pointer to destination memory address
- **symbol** -- **[in]** pointer to the symbol address on the device
- **sizeBytes** -- **[in]** size in bytes to copy
- **offset** -- **[in]** offset in bytes from the start of symbol
- **kind** -- **[in]** type of memory transfer
- **stream** -- **[in]** stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyAsync(void *dst, const void *src, size_t sizeBytes, topsMemcpyKind kind, topsStream_t stream __dparm(0))
```

Copy data from src to dst asynchronously.

For multi-gcu or peer-to-peer configurations, it is recommended to use a stream which is a attached to the device where the src data is physically located. For optimal peer-to-peer copies, the copy device must be able to access the src and dst pointers (by calling topsDeviceEnablePeerAccess with copy agent as the current device and src/dest as the peerDevice argument. if this is not done, the topsMemcpy will still work, but will perform the copy using a staging buffer on the host.

**See also:**

topsMalloc, topsFree, topsHostMalloc, topsHostFree, topsMemGetAddressRange, topsMemGetInfo, topsHostGetDevicePointer, topsMemcpyDtoD, topsMemcpyDtoH, topsMemcpyDtoHAsync, topsMemcpyHtoD, topsMemcpyHtoDAsync

**Warning:**

If host or dest are not pinned, the memory copy will be performed synchronously. For best performance, use topsHostMalloc to allocate host memory that is transferred asynchronously.

**Warning:**

topsMemcpyAsync does not support overlapped H2D and D2H copies. For topsMemcpy, the copy is always performed by the device associated with the specified stream.

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **src** -- **[in]** Data being copy from
- **sizeBytes** -- **[in]** Data size in bytes
- **kind** -- **[in]** type of memory transfer
- **stream** -- **[in]** stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree, #topsErrorUnknown

```cpp
TOPS_PUBLIC_API topsError_t topsMemset(void *dst, int value, size_t sizeBytes)
```

Fills the first sizeBytes bytes of the memory area pointed to by dest with the constant byte value value.

**Parameters:**

- **dst** -- **[out]** Dst Data being filled
- **value** -- **[in]** Constant value to be set
- **sizeBytes** -- **[in]** Data size in bytes

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsMemsetD8(topsDeviceptr_t dest, unsigned char value, size_t count)
```

Fills the first sizeBytes bytes of the memory area pointed to by dest with the constant byte value value.

**Parameters:**

- **dst** -- **[out]** Data ptr to be filled
- **value** -- **[in]** Constant value to be set
- **count** -- **[in]** Number of values to be set

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsMemsetD8Async(topsDeviceptr_t dest, unsigned char value, size_t count, topsStream_t stream __dparm(0))
```

Fills the first sizeBytes bytes of the memory area pointed to by dest with the constant byte value value.

topsMemsetD8Async() is asynchronous with respect to the host, so the call may return before the memset is complete. The operation can optionally be associated to a stream by passing a non-zero stream argument. If stream is non-zero, the operation may overlap with operations in other streams.

**Parameters:**

- **dest** -- **[out]** Data ptr to be filled
- **value** -- **[in]** Constant value to be set
- **count** -- **[in]** Number of values to be set
- **stream** -- **[in]** - Stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsMemsetD16(topsDeviceptr_t dest, unsigned short value, size_t count)
```

Fills the first sizeBytes bytes of the memory area pointed to by dest with the constant short value value.

**Parameters:**

- **dest** -- **[out]** Data ptr to be filled
- **value** -- **[in]** Constant value to be set
- **count** -- **[in]** Number of values to be set

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsMemsetD16Async(topsDeviceptr_t dest, unsigned short value, size_t count, topsStream_t stream __dparm(0))
```

Fills the first sizeBytes bytes of the memory area pointed to by dest with the constant short value value.

topsMemsetD16Async() is asynchronous with respect to the host, so the call may return before the memset is complete. The operation can optionally be associated to a stream by passing a non-zero stream argument. If stream is non-zero, the operation may overlap with operations in other streams.

**Parameters:**

- **dest** -- **[out]** Data ptr to be filled
- **value** -- **[in]** Constant value to be set
- **count** -- **[in]** Number of values to be set
- **stream** -- **[in]** - Stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsMemsetD32(topsDeviceptr_t dest, int value, size_t count)
```

Fills the memory area pointed to by dest with the constant integer value for specified number of times.

**Parameters:**

- **dest** -- **[out]** Data being filled
- **value** -- **[in]** Constant value to be set
- **count** -- **[in]** Number of values to be set

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsMemsetAsync(void *dst, int value, size_t sizeBytes, topsStream_t stream __dparm(0))
```

Fills the first sizeBytes bytes of the memory area pointed to by dev with the constant byte value value.

topsMemsetAsync() is asynchronous with respect to the host, so the call may return before the memset is complete. The operation can optionally be associated to a stream by passing a non-zero stream argument. If stream is non-zero, the operation may overlap with operations in other streams.

**Parameters:**

- **dst** -- **[out]** Pointer to device memory
- **value** -- **[in]** - Value to set for each byte of specified memory
- **sizeBytes** -- **[in]** - Size in bytes to set
- **stream** -- **[in]** - Stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree

```cpp
TOPS_PUBLIC_API topsError_t topsMemsetD32Async(topsDeviceptr_t dst, int value, size_t count, topsStream_t stream __dparm(0))
```

Fills the memory area pointed to by dev with the constant integer value for specified number of times.

topsMemsetD32Async() is asynchronous with respect to the host, so the call may return before the memset is complete. The operation can optionally be associated to a stream by passing a non-zero stream argument. If stream is non-zero, the operation may overlap with operations in other streams.

**Parameters:**

- **dst** -- **[out]** Pointer to device memory
- **value** -- **[in]** - Value to set for each byte of specified memory
- **count** -- **[in]** - number of values to be set
- **stream** -- **[in]** - Stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree

```cpp
TOPS_PUBLIC_API topsError_t topsMemGetInfo(size_t *free, size_t *total)
```

Query memory info.

Return snapshot of free memory, and total allocatable memory on the device.

Returns in *free a snapshot of the current free memory.

**Warning:**

The free memory only accounts for memory allocated by this process and may be optimistic.

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemPtrGetInfo(void *ptr, size_t *size)
```

Query memory pointer info. Return size of the memory pointer.

**Parameters:**

- **size** -- **[out]** The size of memory pointer.
- **ptr** -- **[in]** Pointer to memory for query.

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemGetAddressRange(topsDeviceptr_t *pbase, size_t *psize, topsDeviceptr_t dptr)
```

Get information on memory allocations.

**Parameters:**

- **pbase** -- **[out]** - Base pointer address
- **psize** -- **[out]** - Size of allocation
- **dptr-** -- **[in]** Device Pointer

**Returns:** topsSuccess, topsErrorInvalidDevicePointer

### 2.7. PeerToPeer

This section describes the PeerToPeer device memory access functions of TOPS runtime API.

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceCanAccessPeer(int *canAccess, int deviceId, int peerDeviceId)
```

Checks if peer/esl access between two devices is possible.

**Parameters:**

- **deviceId** -- **[in]** - device id
- **peerDeviceId** -- **[in]** - peer device id
- **canAccess** -- **[out]** - access between two devices, bit[7~0] : Each bit indicating corresponding port status: 1 link, 0 no-link. bit[15~8] : p2p link type: bit8 PCIe switch link, bit9 RCs link, bit10 Die to Die, all 0 means no-p2p-link. bit[23~16] :cluster as device type: 1 cluster as device.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceEnablePeerAccess(int peerDeviceId, unsigned int flags)
```

Set peer/esl access property.

**Parameters:**

- **peerDeviceId** -- **[in]** - peer device id
- **flags** -- **[in]** - access property

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceEnablePeerAccessRegion(int peerDeviceId, void *peerDevPtr, size_t size, void **devPtr)
```

Set peer access property for peer device's region.

**Parameters:**

- **peerDeviceId** -- **[in]** - peer device id
- **peerDevPtr** -- **[in]** - the start device ptr of the peer device's region
- **size** -- **[in]** - the size of the peer device's region
- **devPtr** -- **[out]** - the p2p mapped device address

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceDisablePeerAccessRegion(int peerDeviceId, void *peerDevPtr, size_t size)
```

destroy peer access property for peer device's region.

**Parameters:**

- **peerDeviceId** -- **[in]** - peer device id
- **peerDevPtr** -- **[in]** - the start device ptr of the peer device's region
- **size** -- **[in]** - the size of the peer device's region

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyPeer(void *dst, int dstDevice, const void *src, int srcDevice, size_t sizeBytes)
```

Copies memory from one device to memory on another device.

For topsMemcpyPeer, the copy is always performed by the current device (set by topsSetDevice). For multi-gcu or peer-to-peer configurations, it is recommended to set the current device to the device where the src data is physically located. For optimal peer-to-peer copies, the copy device must be able to access the src and dst pointers (by calling topsDeviceEnablePeerAccess with copy agent as the current device and src/dest as the peerDevice argument.

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **dstDevice** -- **[in]** Dst device id
- **src** -- **[in]** Data being copy from
- **srcDevice** -- **[in]** Src device id
- **sizeBytes** -- **[in]** Data size in bytes

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree, #topsErrorUnknown

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyPeerAsync(void *dst, int dstDevice, const void *src, int srcDevice, size_t sizeBytes, topsStream_t stream)
```

Copies memory from one device to memory on another device asynchronously.

For multi-gcu or peer-to-peer configurations, it is recommended to use a stream which is a attached to the device where the src data is physically located. For optimal peer-to-peer copies, the copy device must be able to access the src and dst pointers (by calling topsDeviceEnablePeerAccess with copy agent as the current device and src/dest as the peerDevice argument.

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **dstDevice** -- **[in]** Dst device id
- **src** -- **[in]** Data being copy from
- **srcDevice** -- **[in]** Src device id
- **sizeBytes** -- **[in]** Data size in bytes
- **stream** -- **[in]** Stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree, #topsErrorUnknown

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyPeerExt(void *dst, int dstDevice, const void *src, int srcDevice, size_t sizeBytes, topsTopologyMapType map, int port)
```

Copies memory from one device to memory on another device with special priority.

For topsMemcpyPeerExt, the copy is always performed by the current device (set by topsSetDevice). For multi-gcu or peer-to-peer configurations, it is recommended to set the current device to the device where the src data is physically located. For optimal peer-to-peer copies, the copy device must be able to access the src and dst pointers (by calling topsDeviceEnablePeerAccess with copy agent as the current device and src/dest as the peerDevice argument.

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **dstDevice** -- **[in]** Dst device id
- **src** -- **[in]** Data being copy from
- **srcDevice** -- **[in]** Src device id
- **sizeBytes** -- **[in]** Data size in bytes
- **map** -- **[in]** The link that is expected to pass
- **port** -- **[in]** ESL port id

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree, #topsErrorUnknown

```cpp
TOPS_PUBLIC_API topsError_t topsMemcpyPeerExtAsync(void *dst, int dstDevice, const void *src, int srcDevice, size_t sizeBytes, topsTopologyMapType map, int port, topsStream_t stream)
```

Copies memory from one device to memory on another device asynchronously with special priority.

For topsMemcpyPeerExtAsync, the copy is always performed by the current device (set by topsSetDevice). For multi-gcu or peer-to-peer configurations, it is recommended to set the current device to the device where the src data is physically located. For optimal peer-to-peer copies, the copy device must be able to access the src and dst pointers (by calling topsDeviceEnablePeerAccess with copy agent as the current device and src/dest as the peerDevice argument.

**Parameters:**

- **dst** -- **[out]** Data being copy to
- **dstDevice** -- **[in]** Dst device id
- **src** -- **[in]** Data being copy from
- **srcDevice** -- **[in]** Src device id
- **sizeBytes** -- **[in]** Data size in bytes
- **map** -- **[in]** The link that is expected to pass
- **port** -- **[in]** ESL port id
- **stream** -- **[in]** Stream identifier

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorMemoryFree, #topsErrorUnknown

### 2.8. Module

This section describes the module management functions of TOPS runtime API.

```cpp
TOPS_PUBLIC_API topsError_t topsModuleLoad(topsModule_t *module, const char *fname)
```

Loads code object from file into a topsModule_t.

**Parameters:**

- **fname** -- **[in]**
- **module** -- **[out]**

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidContext, topsErrorFileNotFound, topsErrorOutOfMemory, topsErrorSharedObjectInitFailed, topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsModuleUnload(topsModule_t module)
```

Frees the module.

**Parameters:** **module** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidValue module is freed and the code objects associated with it are destroyed

```cpp
TOPS_PUBLIC_API topsError_t topsModuleGetFunction(topsFunction_t *function, topsModule_t module, const char *kname)
```

Function with kname will be extracted if present in module.

**Parameters:**

- **module** -- **[in]**
- **kname** -- **[in]**
- **function** -- **[out]**

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidContext, topsErrorNotInitialized, topsErrorNotFound,

```cpp
TOPS_PUBLIC_API topsError_t topsFuncGetAttributes(struct topsFuncAttributes *attr, const void *func)
```

Find out attributes for a given function.

**Parameters:**

- **attr** -- **[out]**
- **func** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidDeviceFunction

```cpp
TOPS_PUBLIC_API topsError_t topsFuncGetAttribute(int *value, topsFunction_attribute attrib, topsFunction_t hfunc)
```

Find out a specific attribute for a given function.

**Parameters:**

- **value** -- **[out]**
- **attrib** -- **[in]**
- **hfunc** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidDeviceFunction

```cpp
TOPS_PUBLIC_API topsError_t topsModuleLoadData(topsModule_t *module, const void *image)
```

builds module from code object which resides in host memory. Image is pointer to that location.

**Parameters:**

- **image** -- **[in]**
- **module** -- **[out]**

**Returns:** topsSuccess, topsErrorNotInitialized, topsErrorOutOfMemory, topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsModuleLoadDataEx(topsModule_t *module, const void *image, unsigned int numOptions, topsJitOption *options, void **optionValues)
```

builds module from code object which resides in host memory. Image is pointer to that location. Options are not used. topsModuleLoadData is called.

**Parameters:**

- **image** -- **[in]**
- **module** -- **[out]**
- **numOptions** -- **[in]** Number of options
- **options** -- **[in]** Options for JIT
- **optionValues** -- **[in]** Option values for JIT

**Returns:** topsSuccess, topsErrorNotInitialized, topsErrorOutOfMemory, topsErrorNotInitialized

```cpp
TOPS_PUBLIC_API topsError_t topsModuleLaunchKernel(topsFunction_t f, unsigned int gridDimX, unsigned int gridDimY, unsigned int gridDimZ, unsigned int blockDimX, unsigned int blockDimY, unsigned int blockDimZ, unsigned int sharedMemBytes, topsStream_t stream, void **kernelParams, void **extra)
```

launches kernel f with launch parameters and shared memory on stream with arguments passed to kernelparams or extra

Please note, TOPS does not support kernel launch with total work items defined in dimension with size gridDim x blockDim >= 2^32. So gridDim.x * blockDim.x, gridDim.y * blockDim.y and gridDim.z * blockDim.z are always less than 2^32.

**Warning:**

kernellParams argument is not yet implemented in TOPS. Please use extra instead. Please refer to tops_porting_driver_api.md for sample usage.

**Parameters:**

- **f** -- **[in]** Kernel to launch.
- **gridDimX** -- **[in]** X grid dimension specified as multiple of blockDimX.
- **gridDimY** -- **[in]** Y grid dimension specified as multiple of blockDimY.
- **gridDimZ** -- **[in]** Z grid dimension specified as multiple of blockDimZ.
- **blockDimX** -- **[in]** X block dimensions specified in work-items
- **blockDimY** -- **[in]** Y grid dimension specified in work-items
- **blockDimZ** -- **[in]** Z grid dimension specified in work-items
- **sharedMemBytes** -- **[in]** Amount of dynamic shared memory to allocate for this kernel. The TOPS-Clang compiler provides support for extern shared declarations.
- **stream** -- **[in]** Stream where the kernel should be dispatched. May be 0, in which case the default stream is used with associated synchronization rules.
- **kernelParams** -- **[in]**
- **extra** -- **[in]** Pointer to kernel arguments. These are passed directly to the kernel and must be in the memory layout and alignment expected by the kernel.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsModuleLaunchKernelEx(const topsLaunchConfig_t *config, topsFunction_t f, void **kernelParams, void **extra)
```

launches kernel f with launch parameters and shared memory on stream with arguments passed to kernelparams or extra

Please note, TOPS does not support kernel launch with total work items defined in dimension with size gridDim x blockDim >= 2^32. So gridDim.x * blockDim.x, gridDim.y * blockDim.y and gridDim.z * blockDim.z are always less than 2^32.

**Warning:**

kernellParams argument is not yet implemented in TOPS. Please use extra instead. Please refer to tops_porting_driver_api.md for sample usage.

**Parameters:**

- **config** -- **[in]** - Launch Configuration.
- **f** -- **[in]** Kernel to launch.
- **kernelParams** -- **[in]**
- **extra** -- **[in]** Pointer to kernel arguments. These are passed directly to the kernel and must be in the memory layout and alignment expected by the kernel.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchCooperativeKernel(const void *f, dim3 gridDim, dim3 blockDimX, void **kernelParams, size_t sharedMemBytes, topsStream_t stream)
```

launches kernel f with launch parameters and shared memory on stream with arguments passed to kernelparams or extra, where thread blocks can cooperate and synchronize as they execute

Please note, TOPS does not support kernel launch with total work items defined in dimension with size gridDim x blockDim >= 2^32.

**Parameters:**

- **f** -- **[in]** Kernel to launch.
- **gridDim** -- **[in]** Grid dimensions specified as multiple of blockDim.
- **blockDim** -- **[in]** Block dimensions specified in work-items
- **kernelParams** -- **[in]** A list of kernel arguments
- **sharedMemBytes** -- **[in]** Amount of dynamic shared memory to allocate for this kernel. The TOPS-Clang compiler provides support for extern shared declarations.
- **stream** -- **[in]** Stream where the kernel should be dispatched. May be 0, in which case the default stream is used with associated synchronization rules.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue, topsErrorCooperativeLaunchTooLarge

### 2.9. Clang

This section describes the API to support the triple-chevron syntax.

```cpp
typedef void(*topsHostFn_t)(void *userData)
```

```cpp
TOPS_PUBLIC_API topsError_t topsConfigureCall(dim3 gridDim, dim3 blockDim, size_t sharedMem __dparm(0), topsStream_t stream __dparm(0))
```

Configure a kernel launch.

Please note, TOPS does not support kernel launch with total work items defined in dimension with size gridDim x blockDim >= 2^32.

**Parameters:**

- **gridDim** -- **[in]** grid dimension specified as multiple of blockDim.
- **blockDim** -- **[in]** block dimensions specified in work-items
- **sharedMem** -- **[in]** Amount of dynamic shared memory to allocate for this kernel. The TOPS-Clang compiler provides support for extern shared declarations.
- **stream** -- **[in]** Stream where the kernel should be dispatched. May be 0, in which case the default stream is used with associated synchronization rules.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsSetupArgument(const void *arg, size_t size, size_t offset)
```

Set a kernel argument.

**Parameters:**

- **arg** -- **[in]** Pointer the argument in host memory.
- **size** -- **[in]** Size of the argument.
- **offset** -- **[in]** Offset of the argument on the argument stack.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchByPtr(const void *func)
```

Launch a kernel.

**Parameters:** **func** -- **[in]** Kernel to launch.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t __topsPushBlockSharedMemAddrConfig(void *blockSharedMemAddr)
```

Push block shared memory address of a kernel launch.

**Parameters:** **blockSharedMemAddr** -- **[in]** Block shared memory address used by kernel.

**Returns:** topsSuccess, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t __topsPopBlockSharedMemAddrConfig(void **blockSharedMemAddr)
```

Pop block shared memory address of a kernel launch.

**Parameters:** **blockSharedMemAddr** -- **[out]** Block shared memory address used by kernel.

**Returns:** topsSuccess, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t __topsPushLaunchDieIdConfig(uint32_t id)
```

Push launch die id for kernel.

**Parameters:** **id** -- **[in]** Die id used by launch kernel.

**Returns:** topsSuccess, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t __topsPopLaunchDieIdConfig(uint32_t *id)
```

Pop die id for kernel launch.

**Parameters:** **id** -- **[out]** Die id used by launch kernel.

**Returns:** topsSuccess, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t __topsPushCallConfiguration(dim3 gridDim, dim3 blockDim, size_t sharedMem __dparm(0), topsStream_t stream __dparm(0))
```

Push configuration of a kernel launch.

Please note, TOPS does not support kernel launch with total work items defined in dimension with size gridDim x blockDim >= 2^32.

**Parameters:**

- **gridDim** -- **[in]** grid dimension specified as multiple of blockDim.
- **blockDim** -- **[in]** block dimensions specified in work-items
- **sharedMem** -- **[in]** Amount of dynamic shared memory to allocate for this kernel. The TOPS-Clang compiler provides support for extern shared declarations.
- **stream** -- **[in]** Stream where the kernel should be dispatched. May be 0, in which case the default stream is used with associated synchronization rules.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t __topsPopCallConfiguration(dim3 *gridDim, dim3 *blockDim, size_t *sharedMem, topsStream_t *stream)
```

Pop configuration of a kernel launch.

Please note, TOPS does not support kernel launch with total work items defined in dimension with size gridDim x blockDim >= 2^32.

**Parameters:**

- **gridDim** -- **[out]** grid dimension specified as multiple of blockDim.
- **blockDim** -- **[out]** block dimensions specified in work-items
- **sharedMem** -- **[out]** Amount of dynamic shared memory to allocate for this kernel. The TOPS-Clang compiler provides support for extern shared declarations.
- **stream** -- **[out]** Stream where the kernel should be dispatched. May be 0, in which case the default stream is used with associated synchronization rules.

**Returns:** topsSuccess, topsInvalidDevice, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchKernel(const void *function_address, dim3 numBlocks, dim3 dimBlocks, void **args, size_t sharedMemBytes __dparm(0), topsStream_t stream __dparm(0))
```

C compliant kernel launch API.

**Parameters:**

- **function_address** -- **[in]** - kernel stub function pointer.
- **numBlocks** -- **[in]** - number of blocks
- **dimBlocks** -- **[in]** - dimension of a block
- **args** -- **[in]** - kernel arguments
- **sharedMemBytes** -- **[in]** - Amount of dynamic shared memory to allocate for this kernel. The TOPS-Clang compiler provides support for extern shared declarations.
- **stream** -- **[in]** - Stream where the kernel should be dispatched. May be 0, in which case the default stream is used with associated synchronization rules.

**Returns:** topsSuccess, topsErrorInvalidValue, topsInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchKernelExC(const topsLaunchConfig_t *config, const void *func, void **args)
```

C compliant kernel launch API.

**Parameters:**

- **config** -- **[in]** - Launch Configuration.
- **func** -- **[in]** - Kernel to launch
- **args** -- **[in]** - Array of pointers to kernel parameters

**Returns:** topsSuccess, topsErrorInvalidValue, topsInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchHostFunc(topsStream_t stream, topsHostFn_t fn, void *userData)
```

Enqueues a host function to run in a stream. The function will be called after currently enqueued work and will block work added after it. The host function must not make any TOPS Runtime API calls. Attempting to use TOPS Runtime APIs may result in unexpected errors.

**See also:**

topsStreamCreate, topsStreamQuery, topsStreamSynchronize, topsStreamWaitEvent, topsStreamDestroy

**Parameters:**

- **stream** -- **[in]** - Stream to add host function to
- **fn** -- **[in]** - The function to call once preceding stream operations are complete
- **userData** -- **[in]** - User specified data to be passed to the host function

**Returns:** topsSuccess, #topsErrorInvalidHandle, topsErrorNotSupported

```cpp
TOPS_PUBLIC_API topsError_t topsOccupancyAvailableDynamicSMemPerBlock(size_t *dynamicSMemSize, const void *func, int numBlocks, int blockSize)
```

Returns dynamic shared memory available per block when launching `numBlocks` blocks on multiprocessor.

Returns in `*dynamicSmemSize` the maximum size of dynamic shared memory to allow `numBlocks` blocks per multiprocessor.

**See also:**

topsOccupancyMaxActiveBlocksPerMultiprocessor, topsOccupancyAvailableDynamicSMemPerBlock_v2, topsOccupancyMaxActiveBlocksPerMultiprocessor_v2

**Parameters:**

- **dynamicSmemSize** -- **[out]** - Returned maximum dynamic shared memory
- **func** -- **[in]** - Kernel function for which occupancy is calculated
- **numBlocks** -- **[in]** - Number of blocks to fit on multiprocessor
- **blockSize** -- **[in]** - Size of the blocks

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidDeviceFunction, topsErrorInvalidValue, topsErrorUnknown,

```cpp
TOPS_PUBLIC_API topsError_t topsOccupancyMaxActiveBlocksPerMultiprocessor(int *numBlocks, const void *func, int blockSize, size_t dynamicSMemSize)
```

Returns occupancy of a device function.

Returns in `*numBlocks` the number of the maximum active blocks per streaming multiprocessor.

**See also:**

topsOccupancyAvailableDynamicSMemPerBlock, topsOccupancyAvailableDynamicSMemPerBlock_v2, topsOccupancyMaxActiveBlocksPerMultiprocessor_v2

**Parameters:**

- **numBlocks** -- **[out]** - Returned occupancy
- **func** -- **[in]** - Kernel for which occupancy is calculated
- **blockSize** -- **[in]** - Block size the kernel is intended to be launched with
- **dynamicSMemSize** -- **[in]** - Per-block dynamic shared memory usage intended, in bytes

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidDeviceFunction, topsErrorInvalidValue, topsErrorUnknown

```cpp
TOPS_PUBLIC_API topsError_t topsOccupancyAvailableDynamicSMemPerBlock_v2(size_t *dynamicSMemSize, const void *func, int numBlocks, int blockSize, int threadSize, size_t dynamicLMemSize)
```

Returns dynamic shared memory available per block when launching `numBlocks` blocks on multiprocessor.

Returns in `*dynamicSmemSize` the maximum size of dynamic shared memory to allow `numBlocks` blocks per multiprocessor.

**See also:**

topsOccupancyAvailableDynamicSMemPerBlock, topsOccupancyAvailableDynamicSMemPerBlock_v2, topsOccupancyMaxActiveBlocksPerMultiprocessor_v2

**Parameters:**

- **dynamicSmemSize** -- **[out]** - Returned maximum dynamic shared memory
- **func** -- **[in]** - Kernel function for which occupancy is calculated
- **numBlocks** -- **[in]** - Number of blocks to fit on multiprocessor
- **blockSize** -- **[in]** - Size of the blocks
- **threadSize** -- **[in]** - Size of the thread
- **dynamicLMemSize** -- **[in]** - Per-block dynamic local memory usage intended, in bytes

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidDeviceFunction, topsErrorInvalidValue, topsErrorUnknown,

```cpp
TOPS_PUBLIC_API topsError_t topsOccupancyMaxActiveBlocksPerMultiprocessor_v2(int *numBlocks, const void *func, int blockSize, int threadSize, size_t dynamicSMemSize, size_t dynamicLMemSize)
```

Returns occupancy of a device function.

Returns in `*numBlocks` the number of the maximum active blocks per streaming multiprocessor.

**See also:**

topsOccupancyAvailableDynamicSMemPerBlock, topsOccupancyAvailableDynamicSMemPerBlock_v2, topsOccupancyMaxActiveBlocksPerMultiprocessor_v2

**Parameters:**

- **numBlocks** -- **[out]** - Returned occupancy
- **func** -- **[in]** - Kernel for which occupancy is calculated
- **blockSize** -- **[in]** - Block size the kernel is intended to be launched with
- **threadSize** -- **[in]** - Size of the thread
- **dynamicSMemSize** -- **[in]** - Per-block dynamic shared memory usage intended, in bytes
- **dynamicLMemSize** -- **[in]** - Per-block dynamic local memory usage intended, in bytes

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidDeviceFunction, topsErrorInvalidValue, topsErrorUnknown

### 2.10. Runtime

This section describes the runtime compilation functions of TOPS runtime API

```cpp
enum topsrtcResult
```

*Values:*

```cpp
enumerator TOPSRTC_SUCCESS
```

```cpp
enumerator TOPSRTC_ERROR_OUT_OF_MEMORY
```

```cpp
enumerator TOPSRTC_ERROR_PROGRAM_CREATION_FAILURE
```

```cpp
enumerator TOPSRTC_ERROR_INVALID_INPUT
```

```cpp
enumerator TOPSRTC_ERROR_INVALID_PROGRAM
```

```cpp
enumerator TOPSRTC_ERROR_INVALID_OPTION
```

```cpp
enumerator TOPSRTC_ERROR_COMPILATION
```

```cpp
enumerator TOPSRTC_ERROR_BUILTIN_OPERATION_FAILURE
```

```cpp
enumerator TOPSRTC_ERROR_NAME_EXPRESSION_NOT_VALID
```

```cpp
enumerator TOPSRTC_ERROR_INTERNAL_ERROR
```

```cpp
typedef enum topsrtcResult topsrtcResult
```

```cpp
typedef struct _topsrtcProgram *topsrtcProgram
```

```cpp
TOPS_PUBLIC_API const char *topsrtcGetErrorString(topsrtcResult result)
```

Returns a string message to describing the error which occurred.

**See also:**

topsrtcResult

**Warning:**

If the topsrtc result is defined, it will return "Invalid TOPSRTC error code"

**Parameters:** **result** -- **[in]** TOPSRTC API result code.

**Returns:** const char message string for the given topsrtcResult code.

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcVersion(int *major, int *minor)
```

Sets the output parameters major and minor with the TOPSRTC version.

**Parameters:**

- **major** -- **[out]** TOPS Runtime Compilation major version number.
- **minor** -- **[out]** TOPS Runtime Compilation minor version number.

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcAddNameExpression(topsrtcProgram program, const char *name_expression)
```

Adds the given name exprssion to the runtime compilation program.

If const char pointer is NULL, it will return TOPSRTC_ERROR_INVALID_INPUT.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[in]** runtime compilation program instance.
- **name_expression** -- **[in]** const char pointer to the name expression.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcCompileProgram(topsrtcProgram program, int num_options, const char **options)
```

Compiles the given runtime compilation program.

If the compiler failed to build the runtime compilation program, it will return TOPSRTC_ERROR_COMPILATION.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[in]** runtime compilation program instance.
- **num_options** -- **[in]** number of compiler options.
- **options** -- **[in]** compiler options as const array of strins.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcCreateProgram(topsrtcProgram *program, const char *source, const char *name, int num_headers, const char **headers, const char **include_names)
```

Creates an instance of topsrtcProgram with the given input parameters, and sets the output topsrtcProgram program with it.

Any invalid input parameter, it will return TOPSRTC_ERROR_INVALID_INPUT or TOPSRTC_ERROR_INVALID_PROGRAM.

If failed to create the program, it will return TOPSRTC_ERROR_PROGRAM_CREATION_FAILURE.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[inout]** runtime compilation program instance.
- **source** -- **[in]** const char pointer to the program source.
- **name** -- **[in]** const char pointer to the program name.
- **num_headers** -- **[in]** number of headers.
- **headers** -- **[in]** array of strings pointing to headers.
- **include_names** -- **[in]** array of strings pointing to names included in program source.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcDestroyProgram(topsrtcProgram *program)
```

Destroys an instance of given topsrtcProgram.

If program is NULL, it will return TOPSRTC_ERROR_INVALID_INPUT.

**See also:**

topsrtcResult

**Parameters:** **program** -- **[in]** runtime compilation program instance.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcGetLoweredName(topsrtcProgram program, const char *name_expression, const char **lowered_name)
```

Gets the lowered (mangled) name from an instance of topsrtcProgram with the given input parameters, and sets the output lowered_name with it.

If any invalid nullptr input parameters, it will return TOPSRTC_ERROR_INVALID_INPUT

If name_expression is not found, it will return TOPSRTC_ERROR_NAME_EXPRESSION_NOT_VALID

If failed to get lowered_name from the program, it will return TOPSRTC_ERROR_COMPILATION.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[in]** runtime compilation program instance.
- **name_expression** -- **[in]** const char pointer to the name expression.
- **lowered_name** -- **[inout]** const char array to the lowered (mangled) name.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcGetProgramLog(topsrtcProgram program, char *log)
```

Gets the log generated by the runtime compilation program instance.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[in]** runtime compilation program instance.
- **log** -- **[out]** memory pointer to the generated log.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcGetProgramLogSize(topsrtcProgram program, size_t *log_size)
```

Gets the size of log generated by the runtime compilation program instance.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[in]** runtime compilation program instance.
- **log_size** -- **[out]** size of generated log.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcGetCode(topsrtcProgram program, char *code)
```

Gets the pointer of compilation binary by the runtime compilation program instance.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[in]** runtime compilation program instance.
- **code** -- **[out]** char pointer to binary.

**Returns:** TOPSRTC_SUCCESS

```cpp
TOPS_PUBLIC_API topsrtcResult topsrtcGetCodeSize(topsrtcProgram program, size_t *codeSizeRet)
```

Gets the size of compilation binary by the runtime compilation program instance.

**See also:**

topsrtcResult

**Parameters:**

- **program** -- **[in]** runtime compilation program instance.
- **code** -- **[out]** the size of binary.

**Returns:** TOPSRTC_SUCCESS

### 2.11. Graph

This section describes the runtime graph functions of TOPS runtime API

```cpp
enum topsGraphNodeType
```

*Values:*

```cpp
enumerator topsGraphNodeTypeKernel
```

GPU kernel node.

```cpp
enumerator topsGraphNodeTypeMemcpy
```

Memcpy node.

```cpp
enumerator topsGraphNodeTypeMemset
```

Memset node.

```cpp
enumerator topsGraphNodeTypeHost
```

Host (executable) node.

```cpp
enumerator topsGraphNodeTypeGraph
```

Node which executes an embedded graph.

```cpp
enumerator topsGraphNodeTypeEmpty
```

Empty (no-op) node.

```cpp
enumerator topsGraphNodeTypeWaitEvent
```

External event wait node.

```cpp
enumerator topsGraphNodeTypeEventRecord
```

External event record node.

```cpp
enumerator topsGraphNodeTypeExtSemaphoreSignal
```

External Semaphore signal node.

```cpp
enumerator topsGraphNodeTypeExtSemaphoreWait
```

External Semaphore wait node.

```cpp
enumerator topsGraphNodeTypeMemAlloc
```

Memory alloc node.

```cpp
enumerator topsGraphNodeTypeMemFree
```

Memory free node.

```cpp
enumerator topsGraphNodeTypeMemcpyFromSymbol
```

MemcpyFromSymbol node.

```cpp
enumerator topsGraphNodeTypeMemcpyToSymbol
```

MemcpyToSymbol node.

```cpp
enumerator topsGraphNodeTypeCooperativeKernel
```

Cooperative kernel node.

```cpp
enumerator topsGraphNodeTypeCount
```

```cpp
enum topsStreamCaptureMode
```

*Values:*

```cpp
enumerator topsStreamCaptureModeGlobal
```

```cpp
enumerator topsStreamCaptureModeThreadLocal
```

```cpp
enumerator topsStreamCaptureModeRelaxed
```

```cpp
enum topsStreamCaptureStatus
```

*Values:*

```cpp
enumerator topsStreamCaptureStatusNone
```

Stream is not capturing.

```cpp
enumerator topsStreamCaptureStatusActive
```

Stream is actively capturing.

```cpp
enumerator topsStreamCaptureStatusInvalidated
```

invalidated, but not terminated

Stream is part of a capture sequence that has been

```cpp
enum topsUserObjectFlags
```

*Values:*

```cpp
enumerator topsUserObjectNoDestructorSync
```

Destructor execution is not synchronized.

```cpp
enum topsUserObjectRetainFlags
```

*Values:*

```cpp
enumerator topsGraphUserObjectMove
```

Add new reference or retain.

```cpp
typedef struct itopsGraph *topsGraph_t
```

An opaque value that represents a tops graph

```cpp
typedef struct topsGraphNode *topsGraphNode_t
```

An opaque value that represents a tops graph node

```cpp
typedef struct topsGraphExec *topsGraphExec_t
```

An opaque value that represents a tops graph Exec

```cpp
typedef struct topsUserObject *topsUserObject_t
```

An opaque value that represents a user obj

```cpp
typedef enum topsGraphNodeType topsGraphNodeType
```

```cpp
typedef struct topsHostNodeParams topsHostNodeParams
```

```cpp
typedef struct topsKernelNodeParams topsKernelNodeParams
```

```cpp
typedef struct topsMemsetParams topsMemsetParams
```

```cpp
typedef struct topsMemAllocNodeParams topsMemAllocNodeParams
```

```cpp
typedef struct topsMemSetNodeParams topsMemSetNodeParams
```

```cpp
typedef union topsKernelNodeAttrValue topsKernelNodeAttrValue
```

```cpp
typedef enum topsStreamCaptureMode topsStreamCaptureMode
```

```cpp
typedef enum topsStreamCaptureStatus topsStreamCaptureStatus
```

```cpp
typedef enum topsUserObjectFlags topsUserObjectFlags
```

```cpp
typedef enum topsUserObjectRetainFlags topsUserObjectRetainFlags
```

```cpp
TOPS_PUBLIC_API topsError_t __topsPushKernelNodeName(char *name)
```

Push user defined name of kernel node.

**Parameters:** **name** -- **[in]** Name of kernel node.

**Returns:** topsSuccess, topsErrorNotInitialized, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t __topsPopKernelNodeName(char *name, int len)
```

Pop name of kernel node.

**Parameters:**

- **name** -- **[out]** Name of kernel node
- **len** -- **[in]**

**Returns:** topsSuccess, topsErrorInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsStreamBeginCapture(topsStream_t stream, topsStreamCaptureMode mode)
```

Begins graph capture on a stream.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **stream** -- **[in]** - Stream to initiate capture.
- **mode** -- **[in]** - Controls the interaction of this capture sequence with other API calls that are not safe.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsStreamEndCapture(topsStream_t stream, topsGraph_t *pGraph)
```

Ends capture on a stream, returning the captured graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **stream** -- **[in]** - Stream to end capture.
- **pGraph** -- **[out]** - returns the graph captured.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsStreamGetCaptureInfo(topsStream_t stream, topsStreamCaptureStatus *pCaptureStatus, unsigned long long *pId)
```

Get capture status of a stream.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **stream** -- **[in]** - Stream under capture.
- **pCaptureStatus** -- **[out]** - returns current status of the capture.
- **pId** -- **[out]** - unique ID of the capture.

**Returns:** topsSuccess, topsErrorStreamCaptureImplicit

```cpp
TOPS_PUBLIC_API topsError_t topsStreamGetCaptureInfo_v2(topsStream_t stream, topsStreamCaptureStatus *captureStatus_out, unsigned long long *id_out __dparm(0), topsGraph_t *graph_out __dparm(0), const topsGraphNode_t **dependencies_out __dparm(0), size_t *numDependencies_out __dparm(0))
```

Get stream's capture state.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **stream** -- **[in]** - Stream under capture.
- **captureStatus_out** -- **[out]** - returns current status of the capture.
- **id_out** -- **[out]** - unique ID of the capture.
- **graph_out** -- **[in]** - returns the graph being captured into.
- **dependencies_out** -- **[out]** - returns pointer to an array of nodes.
- **numDependencies_out** -- **[out]** - returns size of the array returned in dependencies_out.

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorStreamCaptureImplicit

```cpp
TOPS_PUBLIC_API topsError_t topsStreamIsCapturing(topsStream_t stream, topsStreamCaptureStatus *pCaptureStatus)
```

Get stream's capture state.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **stream** -- **[in]** - Stream under capture.
- **pCaptureStatus** -- **[out]** - returns current status of the capture.

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorStreamCaptureImplicit

```cpp
TOPS_PUBLIC_API topsError_t topsStreamUpdateCaptureDependencies(topsStream_t stream, topsGraphNode_t *dependencies, size_t numDependencies, unsigned int flags __dparm(0))
```

Update the set of dependencies in a capturing stream.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **stream** -- **[in]** - Stream under capture.
- **dependencies** -- **[in]** - pointer to an array of nodes to Add/Replace.
- **numDependencies** -- **[in]** - size of the array in dependencies.

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorIllegalState

```cpp
TOPS_PUBLIC_API topsError_t topsThreadExchangeStreamCaptureMode(topsStreamCaptureMode *mode)
```

Swaps the stream capture mode of a thread.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:** **mode** -- **[in]** - Pointer to mode value to swap with the current mode

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphCreate(topsGraph_t *pGraph, unsigned int flags)
```

Creates a graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **pGraph** -- **[out]** - pointer to graph to create.
- **flags** -- **[in]** - flags for graph creation, must be 0.

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorMemoryAllocation

```cpp
TOPS_PUBLIC_API topsError_t topsGraphDestroy(topsGraph_t graph)
```

Destroys a graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:** **graph** -- **[in]** - instance of graph to destroy.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphGetNodes(topsGraph_t graph, topsGraphNode_t *nodes, size_t *numNodes)
```

Returns graph nodes.

nodes may be NULL, in which case this function will return the number of nodes in numNodes. Otherwise, numNodes entries will be filled in. If numNodes is higher than the actual number of nodes, the remaining entries in nodes will be set to NULL, and the number of nodes actually obtained will be returned in numNodes.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **graph** -- **[in]** - instance of graph to get the nodes.
- **nodes** -- **[out]** - pointer to return the graph nodes.
- **numNodes** -- **[out]** - returns number of graph nodes.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphNodeGetType(topsGraphNode_t node, topsGraphNodeType *pType)
```

Returns a node's type.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **node** -- **[in]** - instance of the graph to add dependencies.
- **pType** -- **[out]** - pointer to the return the type

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphInstantiate(topsGraphExec_t *pGraphExec, topsGraph_t graph, topsGraphNode_t *pErrorNode, char *pLogBuffer, size_t bufferSize)
```

Creates an executable graph from a graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **pGraphExec** -- **[out]** - pointer to instantiated executable graph that is created.
- **graph** -- **[in]** - instance of graph to instantiate.
- **pErrorNode** -- **[out]** - pointer to error node in case error occurred in graph instantiation, it could modify the corresponding node.
- **pLogBuffer** -- **[out]** - pointer to log buffer.
- **bufferSize** -- **[out]** - the size of log buffer.

**Returns:** topsSuccess, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsGraphInstantiateWithFlags(topsGraphExec_t *pGraphExec, topsGraph_t graph, unsigned long long flags)
```

Creates an executable graph from a graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues. It does not support any of flag and is behaving as topsGraphInstantiate.

**Parameters:**

- **pGraphExec** -- **[out]** - pointer to instantiated executable graph that is created.
- **graph** -- **[in]** - instance of graph to instantiate.
- **flags** -- **[in]** - Flags to control instantiation, valid only for zero value currently.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphLaunch(topsGraphExec_t graphExec, topsStream_t stream)
```

launches an executable graph in a stream

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **graphExec** -- **[in]** - instance of executable graph to launch.
- **stream** -- **[in]** - instance of stream in which to launch executable graph.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphExecDestroy(topsGraphExec_t graphExec)
```

Destroys an executable graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:** **graphExec** -- **[in]** - instance of executable graph to destroy.

**Returns:** topsSuccess.

```cpp
TOPS_PUBLIC_API topsError_t topsGraphAddKernelNode(topsGraphNode_t *pGraphNode, topsGraph_t graph, const topsGraphNode_t *pDependencies, size_t numDependencies, const topsKernelNodeParams *pNodeParams)
```

Creates a kernel execution node and adds it to a graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **pGraphNode** -- **[out]** - pointer to graph node to create.
- **graph** -- **[in]** - instance of graph to add the created node.
- **pDependencies** -- **[in]** - pointer to the dependencies on the kernel execution node.
- **numDependencies** -- **[in]** - the number of the dependencies.
- **pNodeParams** -- **[in]** - pointer to the parameters to the kernel execution node on the GPU.

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorInvalidDeviceFunction

```cpp
TOPS_PUBLIC_API topsError_t topsGraphKernelNodeGetParams(topsGraphNode_t node, topsKernelNodeParams *pNodeParams)
```

Gets kernel node's parameters.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **node** -- **[in]** - instance of the node to get parameters from.
- **pNodeParams** -- **[out]** - pointer to the parameters

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphKernelNodeSetParams(topsGraphNode_t node, const topsKernelNodeParams *pNodeParams)
```

Sets a kernel node's parameters.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **node** -- **[in]** - instance of the node to set parameters to.
- **pNodeParams** -- **[in]** - const pointer to the parameters.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphKernelNodeGetAttribute(topsGraphNode_t hNode, topsKernelNodeAttrID attr, topsKernelNodeAttrValue *value)
```

Gets a node attribute.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **hNode** -- **[in]** - instance of the node to set parameters to.
- **attr** -- **[in]** - the attribute node is set to.
- **value** -- **[in]** - const pointer to the parameters.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphAddHostNode(topsGraphNode_t *pGraphNode, topsGraph_t graph, const topsGraphNode_t *pDependencies, size_t numDependencies, const topsHostNodeParams *pNodeParams)
```

Creates a host execution node and adds it to a graph.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **pGraphNode** -- **[out]** - pointer to the graph node to create.
- **graph** -- **[in]** - instance of the graph to add the created node.
- **pDependencies** -- **[in]** - const pointer to the dependencies on the memset execution node.
- **numDependencies** -- **[in]** - the number of the dependencies.
- **pNodeParams** -- **[in]** -pointer to the parameters.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceGraphMemTrim(int device)
```

Free unused memory on specific device used for graph back to OS.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:** **device** -- **[in]** - device the memory is used for graphs

```cpp
TOPS_PUBLIC_API topsError_t topsUserObjectCreate(topsUserObject_t *object_out, void *ptr, topsHostFn_t destroy, unsigned int initialRefcount, unsigned int flags)
```

Create an instance of userObject to manage lifetime of a resource.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **object_out** -- **[out]** - pointer to instance of userobj.
- **ptr** -- **[in]** - pointer to pass to destroy function.
- **destroy** -- **[in]** - destroy callback to remove resource.
- **initialRefcount** -- **[in]** - reference to resource.
- **flags** -- **[in]** - flags passed to API.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsUserObjectRelease(topsUserObject_t object, unsigned int count __dparm(1))
```

Release number of references to resource.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **object** -- **[in]** - pointer to instance of userobj.
- **count** -- **[in]** - reference to resource to be retained.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsUserObjectRetain(topsUserObject_t object, unsigned int count __dparm(1))
```

Retain number of references to resource.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **object** -- **[in]** - pointer to instance of userobj.
- **count** -- **[in]** - reference to resource to be retained.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphRetainUserObject(topsGraph_t graph, topsUserObject_t object, unsigned int count __dparm(1), unsigned int flags __dparm(0))
```

Retain user object for graphs.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **graph** -- **[in]** - pointer to graph to retain the user object for.
- **object** -- **[in]** - pointer to instance of userobj.
- **count** -- **[in]** - reference to resource to be retained.
- **flags** -- **[in]** - flags passed to API.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphReleaseUserObject(topsGraph_t graph, topsUserObject_t object, unsigned int count __dparm(1))
```

Release user object from graphs.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **graph** -- **[in]** - pointer to graph to retain the user object for.
- **object** -- **[in]** - pointer to instance of userobj.
- **count** -- **[in]** - reference to resource to be retained.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsGraphDebugDotPrint(topsGraph_t graph, const char *path, unsigned int flags)
```

Write a DOT file describing graph structure.

**Warning:**

This API is marked as beta, meaning, while this is feature complete, it is still open to changes and may have outstanding issues.

**Parameters:**

- **graph** -- **[in]** - graph object for which DOT file has to be generated.
- **path** -- **[in]** - path to write the DOT file.
- **flags** -- **[in]** - Flags from topsGraphDebugDotFlags to get additional node information.

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorOperatingSystem

```cpp
struct topsHostNodeParams
```

```cpp
struct topsKernelNodeParams
```

```cpp
struct topsMemsetParams
```

```cpp
struct topsMemAllocNodeParams
```

```cpp
struct topsMemSetNodeParams
```

```cpp
union topsKernelNodeAttrValue
```

#### Public Members

```cpp
topsAccessPolicyWindow accessPolicyWindow
```

```cpp
int cooperative
```

```cpp
int priority
```

```cpp
size_t blockSharedMemorySize
```

```cpp
char userDefinedName[256]
```

### 2.12. Extension

This section describes the runtime Ext functions of TOPS runtime API

```cpp
TOPS_PUBLIC_API topsError_t topsMemorySetDims(const void *devPtr, int64_t *dims, size_t dims_count)
```

Set dimension for device memory.

Limitation: devPtr only support allocated by topsMalloc*

**Parameters:**

- **devPtr** -- **[in]** The device memory to be set.
- **dims** -- **[in]** The dimension to be set.
- **dims_count** -- **[in]** The dimension size to be set.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsMemoryGetDims(const void *devPtr, int64_t *dims, size_t *dims_count)
```

Get dimension of device memory.

Limitation: devPtr only support allocated by topsMalloc*

**Parameters:**

- **devPtr** -- **[in]** The device memory to be set.
- **dims** -- **[out]** The dimension pointer list to be get.
- **dims_count** -- **[out]** The dimension rank pointer list to be get.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsCreateExecutable(topsExecutable_t *exe, const void *bin, size_t size)
```

Create an executable with specified binary data and size.

Note: Ownership of the pointer to new executable is transferred to the caller. Caller need call topsDestroyExecutable to destroy this pointer when no longer use it.

**Parameters:**

- **bin** -- **[in]** The pointer to the binary data.
- **size** -- **[in]** The size of the binary data.
- **exe** -- **[out]** Pointer to get new executable.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsCreateExecutableFromFile(topsExecutable_t *exe, const char *filepath)
```

Create an executable with specified file.

Note: Ownership of the pointer to new executable is transferred to the caller. Caller need call topsDestroyExecutable to destroy this pointer when no longer use it.

**Parameters:**

- **filepath** -- **[in]** The name of binary file.
- **exe** -- **[out]** Pointer to get new executable.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsDestroyExecutable(topsExecutable_t exe)
```

Destroy and clean up an executable.

**Parameters:** **exe** -- **[in]** Pointer to executable to destroy.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetBinaryPtr(topsExecutable_t exe, void **pointer)
```

Get raw host pointer of the executable binary.

**Parameters:**

- **exe** -- **[in]** Pointer to executable to query binary pointer.
- **pointer** -- **[out]** Return the raw host pointer of binary.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsCreateResource(topsResource_t *res, topsResourceRequest_t req)
```

Create a resource bundle with specified request. If device is in reset status, this method will retry until reset finish.

Note: Ownership of the pointer to new resource bundle is transferred to the caller. Caller need call topsDestroyResource to destroy this pointer when no longer use it.

**Parameters:**

- **res** -- **[out]** Pointer to get new resource bundle or nullptr if failed.
- **req** -- **[in]** Requested resource of allocated resource bundle.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsCreateResourceForExecutable(topsResource_t *res, topsExecutable_t exe)
```

Create a new resource bundle with specified target resource. If device is in reset status, this method will retry until reset finish.

Note: Ownership of the pointer to new resource bundle is transferred to the caller. Caller need call topsDestroyResource to destroy this pointer when no longer use it.

**Parameters:**

- **res** -- **[out]** Pointer to get new resource bundle or nullptr if failed.
- **exe** -- **[in]** Pointer to the executable to get target pointer which contains the requested resource.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsDestroyResource(topsResource_t res)
```

Destroy and clean up a resource bundle.

**Parameters:** **res** -- **[in]** Pointer to resource bundle to destroy.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsResourceBundleGetAttribute(topsResource_t res, topsResourceBundleInfoType_t type, uint64_t *data)
```

Query resource bundle attribute.

**Parameters:**

- **res** -- **[in]** Pointer to resource bundle to query.
- **type** -- **[in]** Type to query.
- **data** -- **[out]** Pointer to query output data.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsMallocForResource(void **ptr, size_t size, topsResource_t res)
```

Allocate memory on the res_bundle affinity memory bank.

If size is 0, no memory is allocated, *ptr returns non-nullptr, and topsSuccess is returned.

Use topsFree to release ptr

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated memory
- **size** -- **[in]** Requested memory size
- **res** -- **[in]** res_bundle

**Returns:** topsSuccess, #topsErrorOutOfMemory, topsErrorInvalidValue (bad context, null *ptr)

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutableV2(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Note: default use runExe with Operator mode (not support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutableV3(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, int64_t *output_dims, size_t *output_rank, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Limitation: for performance, output_dims/output_rank should be set to nullptr. if users set output_dims/output_rank as no-zero, topsLaunchExecutableV3 will insert a blocking mode hostcallback operation to get output_dims and output_rank

Note: default use runExe with Graph mode(support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **output_dims** -- **[out]** Outputs dims List of executable.
- **output_rank** -- **[out]** Outputs dims rank of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutableV4(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, int64_t *output_dims, size_t *output_rank, void **stack_datas, size_t stacks_count, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Limitation: for performance, output_dims/output_rank should be set to nullptr. if users set output_dims/output_rank as no-zero, topsLaunchExecutableV3 will insert a blocking mode hostcallback operation to get output_dims and output_rank

Note: default use runExe with Graph mode(support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **output_dims** -- **[out]** Outputs dims List of executable.
- **output_rank** -- **[out]** Outputs dims rank of executable.
- **stack_datas** -- **[in]** stack_datas of executable.
- **stacks_count** -- **[in]** stacks_datas count of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutable(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, int64_t *output_dims, size_t *output_rank, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Limitation: for performance, output_dims/output_rank should be set to nullptr. if user set output_dims/output_rank no-zero, topsLaunchExecutable may synchronize to get output_dims and output_rank

Note: default use runExe with Graph mode(support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **output_dims** -- **[out]** Outputs dims List of executable.
- **output_rank** -- **[out]** Outputs dims rank of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutableWithConstData(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, int64_t *output_dims, size_t *output_rank, void **const_datas, size_t const_datas_count, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Limitation: for performance, output_dims/output_rank should be set to nullptr. if user set output_dims/output_rank no-zero, topsLaunchExecutableWithConstData may synchronize to get output_dims and output_rank

Note: default use runExe with Graph mode(support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **output_dims** -- **[out]** Outputs dims List of executable.
- **output_rank** -- **[out]** Outputs dims rank of executable.
- **const_datas** -- **[in]** Const_datas of executable.
- **const_datas_count** -- **[in]** Const_datas count of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutableWithConstDataV2(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, void **const_datas, size_t const_datas_count, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Note: default use runExe with Operator mode (not support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **const_datas** -- **[in]** Const_datas of executable.
- **const_datas_count** -- **[in]** Const_datas count of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutableWithConstDataV3(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, int64_t *output_dims, size_t *output_rank, void **const_datas, size_t const_datas_count, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Limitation: for performance, output_dims/output_rank should be set to nullptr. if users set output_dims/output_rank as no-zero, topsLaunchExecutableWithConstDataV3 will insert a blocking mode hostcallback operation to get output_dims and output_rank

Note: default use runExe with Graph mode(support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **output_dims** -- **[out]** Outputs dims List of executable.
- **output_rank** -- **[out]** Outputs dims rank of executable.
- **const_datas** -- **[in]** Const_datas of executable.
- **const_datas_count** -- **[in]** Const_datas count of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsLaunchExecutableWithConstDataV4(topsExecutable_t exe, topsResource_t res, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, int64_t *output_dims, size_t *output_rank, void **const_datas, size_t const_datas_count, void **stack_datas, size_t stacks_count, topsStream_t stream)
```

Asynchronously run a executable.

Run an executable with given inputs and outputs for training.

Limitation: for performance, output_dims/output_rank should be set to nullptr. if users set output_dims/output_rank as no-zero, topsLaunchExecutableWithConstDataV3 will insert a blocking mode hostcallback operation to get output_dims and output_rank

Note: default use runExe with Graph mode(support dynamic shape), and if res is nullptr, use default res_bundle

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **inputs** -- **[in]** Inputs of executable.
- **input_count** -- **[in]** Inputs count of executable.
- **input_dims** -- **[in]** Inputs dims List of executable.
- **input_rank** -- **[in]** Inputs dims rank of executable.
- **outputs** -- **[in]** Outputs of executable.
- **output_count** -- **[in]** Outputs count of executable.
- **output_dims** -- **[out]** Outputs dims List of executable.
- **output_rank** -- **[out]** Outputs dims rank of executable.
- **const_datas** -- **[in]** Const_datas of executable.
- **const_datas_count** -- **[in]** Const_datas count of executable.
- **stack_datas** -- **[in]** stack_datas of executable.
- **stacks_count** -- **[in]** stacks_datas count of executable.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetConstManagedData(topsExecutable_t exe, unsigned int *numOptions, char **name, void **address, uint64_t *size)
```

Get Const Managed Data.

Note: call twice, first get numOptions, Second get the rest only support hp off

**Parameters:**

- **numOptions** -- **[out]** Pointer to ConstManagedData array size.
- **exe** -- **[in]** Pointer to executable object.
- **name** -- **[out]** ConstManaged pair of name.
- **address** -- **[out]** ConstManaged pair of address.
- **size** -- **[out]** ConstManaged address pair of size.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetConstManagedDataV2(topsExecutable_t exe, unsigned int *numOptions, char **name, void **address, uint64_t *size, int64_t *uid, void **flag)
```

Get Const Managed Data.

Note: call twice, first get numOptions, Second get the rest support both hp off and hp on

**Parameters:**

- **numOptions** -- **[out]** Pointer to ConstManagedData array size.
- **exe** -- **[in]** Pointer to executable object.
- **name** -- **[out]** ConstManaged pair of name.
- **address** -- **[out]** ConstManaged pair of address.
- **size** -- **[out]** ConstManaged address pair of size.
- **uid** -- **[out]** Constant uid
- **flag** -- **[out]** Flag used by user to indicate constant partial h2d

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableUpdateConstantKey(topsExecutable_t exe)
```

Update Constant Section Key.

Note: must called before save executable to file

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableUpdateRuntimeResource(topsExecutable_t exe, topsResource_t res, topsStream_t stream)
```

Update Executable Runtime Resource.

Note: call after refit, will update constant partially by h2d

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableLoadConstData(topsExecutable_t exe, topsResource_t res, void **dev_ptr, size_t *dev_ptr_count)
```

Load constant data.

NOTE: is deprecated because of twice call

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **dev_ptr** -- **[out]** Dev_mem of executable.
- **dev_ptr_count** -- **[out]** Dev_mem count of executable.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableLoadConstDataV2(topsExecutable_t exe, topsResource_t res, void **dev_ptr)
```

Load constant data.

NOTE: call topsExecutableQueryInfo to get device mem count to initialize dev_ptr

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **res** -- **[in]** Pointer to res_bundle object.
- **dev_ptr** -- **[out]** Dev_mem of executable.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetRuntimeOutputShape(topsExecutable_t exe, topsShape_t *inputs_shape, topsShape_t *outputs_shape, bool *infer_success)
```

Get runtime dynamic output shape.

Note: flag indicate shape infer result, true for success and false for failed. for shape infer failed and legacy executable, return static output shape

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **inputs_shape** -- **[in]** Pointer to input shape.
- **outputs_shape** -- **[out]** Pointer to output shape.
- **infer_success** -- **[out]** flag to indicate shape infer result.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetRuntimeOutputShapeV2(topsExecutable_t exe, topsTensorStruct_t *inputs, topsShape_t *outputs_shape, bool *infer_success)
```

Get runtime dynamic output shape.

Note: flag indicate shape infer result, true for success and false for failed. for shape infer failed and legacy executable, return static output shape

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **inputs** -- **[in]** Pointer to input.
- **outputs_shape** -- **[out]** Pointer to output shape.
- **infer_success** -- **[out]** flag to indicate shape infer result.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetSubFuncInfo(topsExecutable_t exe, char **info_raw_data, size_t *info_size, int **param_info, int *param_count)
```

get excutable sub function information

Note: use only in refit stage 2, user should parse the Info_RawData to get detailed sub function information example: param_info[2, 1, 3, 2, 3, 1] means subfuncA need 2 inputs, 1 output; subfuncB need 3 inputs, 2 outputs; subfuncC need 3 inputs, 1 output

**Parameters:**

- **exe** -- **[in]** Pointer to executable object
- **Info_RawData** -- **[out]** raw data of sub function information
- **Info_size** -- **[out]** size of Info_RawData
- **param_info** -- **[out]** count list of input and output for each sub function
- **param_count** -- **[out]** total count of input and output

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetRefitFlag(topsExecutable_t exe, int *refit_flag)
```

get excutable refit flag

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **refit_flag** -- **[out]** the flag indicate if this executable is refitable

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableCallSubFunc(topsExecutable_t exe, const char *func_name, void **inputs, size_t input_count, int64_t *input_dims, size_t *input_rank, void **outputs, size_t output_count, topsStream_t stream)
```

call sub function in executable

Limitation: inputs and outputs only support alloc by topsMalloc/topsHostMalloc

Note: use only in refit stage 2 for constant preprocessing

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **func_name** -- **[in]** sub function name
- **inputs** -- **[in]** Inputs of sub function.
- **input_count** -- **[in]** Inputs count of sub function.
- **input_dims** -- **[in]** Inputs dims List of sub function.
- **input_rank** -- **[in]** Inputs dims rank of sub function.
- **outputs** -- **[in]** Outputs of sub function.
- **output_count** -- **[in]** Outputs count of sub function.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceSetResource(topsResource_t res)
```

Set default resource_bundle.

Limitation: set current thread global resource_bundle, set resource_bundle before all tops APIs

**Parameters:** **res** -- **[in]** Pointer to res_bundle object.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsConstBufferGet(uint64_t hash_key, void *init_data, size_t size, void **ptr, topsStream_t stream)
```

Get const buffer.

Get or init const buffer with special hash_key

**Parameters:**

- **hash_key** -- **[in]** value to const buffer special key.
- **init_data** -- **[in]** Pointer to const raw buffer.
- **size** -- **[in]** Size to const buffer size.
- **ptr** -- **[out]** Pointer to get const buffer.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsConstBufferPut(uint64_t hash_key, topsStream_t stream)
```

Put const buffer.

**Parameters:**

- **hash_key** -- **[in]** value to const buffer special key.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableQueryInfo(topsExecutable_t exe, topsExecutableInfoType_t info_type, uint64_t *data)
```

Query executable info.

Limitation: user need to allocate memory for data

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **info_type** -- **[in]** Type to query.
- **data** -- **[out]** Pointer to query output data.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableQueryInfoV2(topsExecutable_t exe, topsExecutableInfoType_t info_type, int64_t *data)
```

Query executable info.

Limitation: user need to allocate memory for data

NOTE: bool information also return by data, 1:true, 0:false

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **info_type** -- **[in]** Type to query.
- **data** -- **[out]** Pointer to query output data.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableQueryInfoV3(topsExecutable_t exe, topsExecutableInfoType_t info_type, char **data)
```

Query executable string info.

Limitation: user need to allocate memory for data

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **info_type** -- **[in]** Type to query.
- **data** -- **[out]** Pointer to query output string info.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableQueryInputName(topsExecutable_t exe, int index, char **name)
```

Query executable input name.

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **index** -- **[in]** Specify which input to query.
- **name** -- **[out]** The name of the input.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableQueryOutputName(topsExecutable_t exe, int index, char **name)
```

Query executable output name.

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **index** -- **[in]** Specify which output to query.
- **name** -- **[out]** The name of the output.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableSaveToFile(topsExecutable_t exe, const char *path)
```

Save executable to a specified file.

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **path** -- **[in]** The name of the file to be used to save executable.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExtMallocWithBank(void **ptr, size_t size, uint64_t bank)
```

Allocate memory on the specify memory bank.

If size is 0, no memory is allocated, *ptr returns non-nullptr, and topsSuccess is returned.

NOTE: default bank is 0

Use topsFree to release ptr

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated memory
- **size** -- **[in]** Requested memory size
- **bank** -- **[in]** memory bank

**Returns:** topsSuccess, #topsErrorOutOfMemory, topsErrorInvalidValue (bad context, null *ptr)

```cpp
TOPS_PUBLIC_API topsError_t topsExtMallocWithBankV2(void **ptr, size_t size, uint64_t bank, unsigned int flags)
```

Allocate memory on the specify memory bank.

If size is 0, no memory is allocated, *ptr returns non-nullptr, and topsSuccess is returned.

NOTE: default bank is 0

Use topsFree to release ptr

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated memory
- **size** -- **[in]** Requested memory size
- **bank** -- **[in]** memory bank
- **flags** -- **[in]** Type of memory allocation. flags only support topsDeviceMallocDefault/topsMallocTopDown/topsMallocForbidMergeMove

**Returns:** topsSuccess, #topsErrorOutOfMemory, topsErrorInvalidValue (bad context, null *ptr)

```cpp
TOPS_PUBLIC_API topsError_t topsExtMallocWithAffinity(void **ptr, size_t size, uint64_t bank, unsigned int flags)
```

Allocate memory on the logical memory bank.

If size is 0, no memory is allocated, *ptr returns non-nullptr, and topsSuccess is returned.

NOTE: default bank is 0, the logical bank will be mapped to physical bank

Use topsFree to release ptr

**Parameters:**

- **ptr** -- **[out]** Pointer to the allocated memory
- **size** -- **[in]** Requested memory size
- **bank** -- **[in]** memory bank
- **flags** -- **[in]** Type of memory allocation. flags only support topsDeviceMallocDefault/topsMallocTopDown/topsMallocForbidMergeMove

**Returns:** topsSuccess, #topsErrorOutOfMemory, topsErrorInvalidValue (bad context, null *ptr)

```cpp
TOPS_PUBLIC_API topsError_t topsExtLaunchCooperativeKernelMultiCluster(const topsExtLaunchParams_t *launchParamsList, int numClusters, dim3 gridDim, dim3 blockDim, topsStream_t stream)
```

Asynchronously launch kernel.

**Parameters:**

- **launchParamsList** -- **[in]** Pointer to launch params List.
- **numClusters** -- **[in]** Size to use cluster count.
- **gridDim** -- **[in]** Grid Dimension to use.
- **blockDim** -- **[in]** Block Dimension to use.
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExtSetProfileMeta(uint8_t *meta, uint32_t size, int64_t compilation_id)
```

Set profile meta data.

**Parameters:**

- **Pointer** -- **[in]** to profile meta data.
- **profile** -- **[in]** meta data size in bytes.
- **compilation** -- **[in]** id.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExtSetProfileMetas(uint32_t meta_cnt, uint8_t *metas[], uint32_t size[], int64_t compilation_id[])
```

Set profile meta data with array.

**Parameters:**

- **meta** -- **[in]** data count.
- **Pointer** -- **[in]** to profile meta data array.
- **profile** -- **[in]** meta data size array in bytes.
- **compilation** -- **[in]** id array.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsScatterMemoryGetInfo(const void *dev_ptr, int index, int64_t *win_pos, size_t *win_size, int64_t *map_ctrl, size_t *map_size)
```

get scatter memory config: win_pos and map_ctrl.

This interface only works when dev_ptr is created with topsMallocForScatter and init with topsScatterSetSubMem.

Limitation: user need to allocate memory win_pos/map_ctrl array

**Parameters:**

- **dev_ptr** -- **[in]** Pointer to scatter memory.
- **index** -- **[in]** Index to sub mem.
- **win_pos** -- **[in]** Pointer to sub memory window position.
- **win_size** -- **[in]** Pointer to sub memory window position size.
- **map_ctrl** -- **[in]** Pointer to sub memory map ctrl.
- **map_size** -- **[in]** Pointer to sub memory map ctrl size.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsScatterMemoryGetSubNum(const void *dev_ptr, size_t *size)
```

Get the sub memory number in a scatter memory.

This interface only works when dev_ptr is created with topsMallocScatter and init with topsScatterSetSubMem.

**Parameters:**

- **dev_ptr** -- **[in]** Pointer to scatter memory.
- **Size** -- **[in]** Pointer to sub memory number size.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsMallocScatter(void **ptr, size_t size)
```

Creates scatter memory on local device.

Creates device memory object for holding a list of scattered DeviceMemory objects. Memory is not actually allocated. User can call topsScatterPopulateSub to allocate sub device memory and topsScatterGetSubMem to query sub memory objects. Scatter DeviceMemory handles will be automatically processed by runtime API such like topsMemcpy, it can be viewed as a plain memory buffer.

Use topsFree to release ptr

A scatter DeviceMemory is invalid until it's fully constructed with correctly split sub DeviceMemory objects both in size and dimension (all related DeviceMemory objects have invoked SetDims).

**Parameters:**

- **ptr** -- **[in]** Pointer to the allocated memory
- **size** -- **[in]** Requested creation size in bytes.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsScatterPopulateSub(const void *dev_ptr, size_t bpe, uint64_t bank, int64_t *dims, int64_t *win_pos, int64_t *map_ctrl, size_t rank_size)
```

Populate scatter memory with sub-memory.

This interface only works when dev_ptr is created with topsMallocScatter API. Each invocation populates one sub-memory. The parent scatter memory owns this sub-memory, that all populated sub-memory are freed if parent is free. topsScatterGetSubMem WON'T retain the sub-memory.

**Parameters:**

- **dev_ptr** -- **[in]** Pointer to scatter memory.
- **bpe** -- **[in]** memory bpe of single sub-memory.
- **bank** -- **[in]** memory bank of single sub-memory.
- **dims** -- **[in]** The dimension to be set.
- **win_pos** -- **[in]** The anchor of window in the scatter memory holding this submemory.
- **map_ctrl** -- **[in]** The dimension remap of reshaping. It's a natural number up to rank.
- **rank_size** -- **[in]** The size of map ctrl/dims/win_position, the max size is 8.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsScatterInplace(const void *dev_ptr, size_t sub_count, size_t bpe, uint64_t *bank_list, int64_t **dims_list, int64_t **win_pos_list, int64_t **map_ctrl_list, size_t rank_size)
```

Inplace scatter memory with sub-memory description.

This interface only works when dev_ptr is created with topsMallocScatter API. The parent scatter memory owns this sub-memory, that all populated sub-memory are freed if parent is free.

topsScatterGetSubMem WON'T retain the sub-memory.

**Parameters:**

- **dev_ptr** -- **[in]** Pointer to scatter memory, if dev_ptr has sub_memory, sub memory must be allocated by topsScatterPopulateSub
- **sub_count** -- **[in]** Number of sub memory
- **bpe** -- **[in]** memory bpe of single sub-memory.
- **bank_list** -- **[in]** memory bank of sub-memory list.
- **dims_list** -- **[in]** The dimension list to be set.
- **win_pos_list** -- **[in]** The anchor of window list in the scatter memory holding this submemory.
- **map_ctrl_list** -- **[in]** The dimension remap of reshaping list. It's a natural number up to rank.
- **rank_size** -- **[in]** The size of map ctrl/dims/win_position, the max size is 8.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsScatterGetSubMem(const void *dev_ptr, int index, void **sub_dptr)
```

Get a submemory from scatter memory .

This interface only works when DeviceMemory is created with topsMallocScatter API. In fact, user can hold the sub DeviceMemory instead of getting it from scatter.

**Parameters:**

- **dev_ptr** -- **[in]** Pointer to scatter memory.
- **index** -- **[in]** The index returned by ScatterSetSubMemory.
- **sub_dptr** -- **[in]** The submemory object that user set by topsScatterSetSubMem.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsMemoryReduceAsync(void *lhs, void *rhs, void *result, enum topsReduceOpType op, enum topsReduceDataType dtype, uint32_t element_cnt, topsStream_t stream)
```

Asynchronously request reduce service.

Request reduce service on Device. The lhs, rhs and result should be on the same device

**Parameters:**

- **lhs** -- **[in]** Left Hand Side device memory address object.
- **rhs** -- **[in]** Right Hand Side device memory object.
- **result** -- **[in]** Result device memory object.
- **op** -- **[in]** Reduce op type.
- **dtype** -- **[in]** Reduce data type.
- **element_cnt** -- **[in]** Count of data to do the calculation
- **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsMemCachePrefetch(topsDeviceptr_t dptr, size_t size)
```

Prefetch the contents of a device memory to L2 buffer. The API is available for GCU 3.0 product only, no effect for other products. A device memory range is defined through device memory pointer and size. A device memory range can be equal to original device memory or a sub range of original device memory. Upper-level software needs to guarantee sub memories have no overlap. Before prefetch, need to make sure the contents on device memory is ready.

**Parameters:**

- **dptr** -- **[in]** Global device pointer
- **size** -- **[in]** Global size in bytes

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorMemoryAllocation

```cpp
TOPS_PUBLIC_API topsError_t topsMemCacheInvalidate(topsDeviceptr_t dptr, size_t size)
```

Inavlidate L2 buffer cache data. The API is available for GCU 3.0 product only, no effect for other products. The API deletes L2 buffer cache data which it is prefetched through API topsMemCachePrefetch(). The original device memory keeps no change. A device memory range is defined through device memory pointer and size.

**Parameters:**

- **dptr** -- **[out]** Global device pointer
- **size** -- **[out]** Global size in bytes

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorMemoryAllocation

```cpp
TOPS_PUBLIC_API topsError_t topsMemCacheInvalidateAll(topsStream_t stream)
```

Invalidate all caches of device memory.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsMemCacheFlushAll(topsStream_t stream)
```

Flush all caches of device memory.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExtGetMcAvailableMemSize(uint64_t mc, uint64_t *size)
```

Get available memory size for mc

**Parameters:**

- **mc** -- **[in]** mc index.
- **size** -- **[out]** Pointer to available size for this mc.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetSectionCount(topsExecutable_t exe, topsExtExecutableSectionHeaderType_t sh_type, uint64_t *count)
```

Get section count of the executable

Note: call with sh_type = topsExtExecutableSectionHeaderType::SHT_LAST_TYPE will return total section counts of executable

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **sh_type** -- **[in]** Section header type.
- **count** -- **[out]** Pointer to count of the section.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetStackSize(topsExecutable_t exe, uint64_t *stack_count, uint64_t *stack_size)
```

Get stack size of the executable

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **stack** -- **[out]** count pointer to count stack size
- **array** -- **[out]** to return stack size for every bank.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsExecutableGetSectionInfo(topsExecutable_t exe, topsExtExecutableSectionHeaderType_t sh_type, int mc, topsExtExecutableSectionInfo_t *info)
```

Get specific section information of the executable

**Parameters:**

- **exe** -- **[in]** Pointer to executable object.
- **sh_type** -- **[in]** Section header type.
- **mc** -- **[in]** mc index.
- **info** -- **[out]** section information.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsGetMemUsageInfo(size_t *current_used_bytes, size_t *peek_used_bytes, int bank_total)
```

Get memory usage information.

**Parameters:**

- **current_used_bytes** -- **[out]** Current size of used memory in bytes.
- **peak_used_bytes** -- **[out]** Peak size of used memory in bytes.
- **bank_total** -- **[in]** The total number of memory bank.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsGetAffinityBankList(int *affinity_bank_list, int bank_total)
```

Get memory bank list of affinity

**Parameters:**

- **affinity_bank_list** -- **[out]** Affinity bank list of memory.
- **bank_total** -- **[in]** The total number of memory bank.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsGetAffinityBankListV2(topsResource_t res, int *affinity_bank_list, int bank_total)
```

Get memory bank list of affinity

**Parameters:**

- **res** -- **[in]** Pointer to res_bundle object.
- **affinity_bank_list** -- **[out]** Affinity bank list of memory.
- **bank_total** -- **[in]** The total number of memory bank.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsMemGetInfoExt(size_t *used_list, size_t *free_list, size_t *max_available_list, size_t *total_list, int bank_total)
```

Query memory usage info list.

Return list of free, used, max available, and total memory on the memory bank.

Note: Tops cannot guarantee the allocation of all free memory. On the platform supporting UVA, the actual free or maximum allocatable space is affected by the OS's dynamic allocation of page tables. Users are advised to reserve some space when allocating the maximum available memory in practice.

**Parameters:**

- **used_list** -- **[out]** Pointer to used memory list.
- **free_list** -- **[out]** Pointer to free memory list.
- **max_available_list** -- **[out]** Pointer to max_available memory list.
- **total_list** -- **[out]** Pointer to total memory list.
- **bank_total** -- **[in]** The total number of memory bank.

**Returns:** topsSuccess, topsErrorInvalidDevice, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsKernelSignalMaxNumGet(int *num)
```

get the maximum kernel signal number on current device. depend on sp, not support on virtual device

**Parameters:** **num** -- **[out]** a pointer to the variable alloced by caller.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsKernelSignalAvailableNumGet(int *num)
```

get the available kernel signal number on current device. depend on sp, not support on virtual device

**Parameters:** **num** -- **[out]** a pointer to the variable alloced by caller.

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsKernelSignalAlloc(int *handle)
```

get a kernel signal handle alloced by kmd on current device. depend on sp, not support on virtual device

**Parameters:** **handle** -- **[out]** put output of handle on here

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsKernelSignalFree(int handle)
```

free a kernel signal handle alloced by kmd on current device. depend on sp, not support on virtual device

**Parameters:** **handle** -- **[in]** the kernel signal handle

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsKernelSignalRead(int handle, uint32_t *value)
```

get a kernel signal value indicated by handle. depend on sp, not support on virtual device

**Parameters:**

- **handle** -- **[in]** the kernel signal handle
- **value** -- **[out]** put output of value on here

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsKernelSignalWrite(int handle, uint32_t value)
```

set a kernel signal value indicated by handle. depend on sp, not support on virtual device

**Parameters:**

- **handle** -- **[in]** the kernel signal handle
- **value** -- **[in]** the value of kernel signal

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceCreateQueue(uint32_t port, topsDeviceptr_t sq_base_ptr, size_t sq_size, uint8_t sq_user, uint32_t *q_id)
```

create a roce sq.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **sq_base_ptr** -- **[in]** the base address of the sq's ring buffer
- **sq_size** -- **[in]** the size of the sq's ring buffer
- **sq_user** -- **[in]** the user of the sq
- **q_id** -- **[out]** the allocated sq id

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceQueryQueue(uint32_t port, uint32_t q_id, uint64_t *mac, uint32_t *ip)
```

query the specified sq's info.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the sq id
- **mac** -- **[out]** mac address binded with the sq
- **id** -- **[out]** ip address binded with the sq

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceBindQueuePair(uint32_t port, uint32_t q_id, uint32_t remote_q_id, uint64_t remote_mac, uint32_t remote_ip)
```

Bind a queue pair.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the local sq id
- **remote_q_id** -- **[in]** the remote sq id
- **remote_mac** -- **[in]** the remote mac address binded with the remote sq
- **remote_ip** -- **[in]** the remote ip address binded with the remote sq

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceDeleteQueue(uint32_t port, uint32_t q_id)
```

Delete a sq.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the local sq id

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRocePostSend(uint32_t port, uint32_t q_id, topsRoceSendWR_t *wr)
```

Send a work request to a sq.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the local sq id
- **wr** -- **[in]** the work request

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRocePollHwPtr(uint32_t port, uint32_t q_id, uint32_t *hw_ptr)
```

Poll a sq's hardware pointer.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the local sq id
- **hw_ptr** -- **[out]** the polled hardware pointer

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceWrite(uint32_t port, uint32_t q_id, uint64_t dst, uint64_t src, size_t size)
```

emit a write request to sq for slave mode.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the local sq id
- **dst** -- **[in]** destination device addr
- **src** -- **[in]** source device addr
- **size** -- **[in]** the write request size

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceRegMem(uint32_t port, uint32_t q_id, void *peer_ptr, size_t size, void **ptr)
```

register peer device memory to local ESL window for slave mode access.

**Parameters:**

- **port** -- **[in]** the local ROCE port id
- **q_id** -- **[in]** the local queue id
- **peer_ptr** -- **[in]** peer device memory ptr
- **size** -- **[in]** peer device memory size
- **ptr** -- **[out]** the local mapped memory ptr

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceUnregMem(void *ptr)
```

de-register the mapped memory for slave mode access.

**Parameters:** **ptr** -- **[in]** the local mapped memory ptr

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceQueryQueueAttributes(uint32_t port, uint32_t q_id, topsRoceQueueAttribute_t *attribute)
```

query ROCE queue's attribute.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the local sq id
- **attribute** -- **[out]** the attribute

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsRoceModifyQueue(uint32_t port, uint32_t q_id, int attr_mask, topsRoceQueueAttribute_t *attribute)
```

modify ROCE queue's attribute.

**Parameters:**

- **port** -- **[in]** the ROCE port id
- **q_id** -- **[in]** the local sq id
- **attr_mask** -- **[in]** the attribute mask
- **attribute** -- **[out]** the attribute

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsGetGlobalRandomSeed(uint64_t *seed)
```

get global random seed.

Note: is deprecated, no longer support random seed

**Parameters:** **seed** -- **[out]** global random seed

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t topsSetGlobalRandomSeed(uint64_t seed)
```

set global random seed.

Note: is deprecated, no longer support random seed

**Parameters:** **seed** -- **[in]** global random seed

**Returns:** topsSuccess on success, or other on failure.

```cpp
TOPS_PUBLIC_API topsError_t __topsStreamSyncDeviceOnly(topsStream_t stream)
```

Only wait for all device commands in stream to complete, DO NOT sync host callbacks and release functions.

This command is NOT host-synchronous : Completion of host callbacks and release functions is NOT guaranteed immediately after this command. If synchronization with the host is important, consider using topsStreamSynchronize.

This command follows standard null-stream semantics. Specifically, specifying the null stream will cause the command to wait for other streams on the same device to complete all pending operations.

**See also:**

topsStreamCreate, topsStreamWaitEvent, topsStreamDestroy, topsStreamSynchronize

**Parameters:** **stream** -- **[in]** stream identifier.

**Returns:** topsSuccess, #topsErrorInvalidHandle

```cpp
TOPS_PUBLIC_API topsError_t topsResourceReservationCreate(topsResourceReservation_t *pReservation, topsResourceReservationParam *paramArray, int numParams)
```

Create a resource reservation. This reservation can be configured for the context of any thread, and the thread that has configured this reservation will use the resources of this reservation.

Note: The API is deprecated

**See also:**

topsSetDeviceWithReservation, topsResourceReservationDestroy, topsDeviceSetHighspeedMem

**Parameters:**

- **pReservation** -- **[in]** Handle of the reservation.
- **paramArray** -- **[in]** Array of resource parameters that need to be configured.
- **numParams** -- **[in]** Number of elements in paramArray.

**Returns:** topsSuccess, topsErrorInvalidValue, topsErrorInvalidDevice

```cpp
TOPS_PUBLIC_API topsError_t topsSetDeviceWithReservation(int device_id, topsResourceReservation_t reservation)
```

Set the resource reservation for the current thread, and this thread will subsequently use the resources within this reservation. At the same time, the device properties related to these resources will also change accordingly.

Note: The API is deprecated

**See also:**

topsResourceReservationCreate, topsResourceReservationDestroy, topsDeviceSetHighspeedMem

**Parameters:**

- **device_id** -- **[in]** Assign the reservation to which device.
- **reservation** -- **[in]** Handle of the reservation.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsResourceReservationDestroy(topsResourceReservation_t reservation)
```

Destroy a reservation, please note that any resources allocated by the threads using this reservation will also be destroyed and become invalid.

Note: The API is deprecated

**See also:**

topsResourceReservationCreate, topsSetDeviceWithReservation, topsDeviceSetHighspeedMem

**Parameters:** **reservation** -- **[in]** Handle of the reservation.

**Returns:** topsSuccess, topsErrorInvalidValue

```cpp
TOPS_PUBLIC_API topsError_t topsDeviceSetHighspeedMem(topsHighspeedMemConfig_t *config)
```

Set the high-speed memory used by the current thread, high-speed memory is typically shared memory. This call may affect the size of shared memory dynamically used by the operator.

**See also:**

topsResourceReservationCreate, topsResourceReservationDestroy, topsSetDeviceWithReservation

**Note:**

this interface will be affected by the resource reservation, and the configured high-speed memory will be allocated from the reservation.

**Parameters:** **config** -- **[in]** Configuration of high-speed memory.

**Returns:** topsSuccess, topsErrorInvalidValue, #topsErrorOutOfMemory

```cpp
TOPS_PUBLIC_API topsError_t topsStreamGetSharedMemPeak(topsStream_t stream, size_t *sharedMemPeak)
```

Return topsSuccess if successfully query the peak share memory usages of a stream, or topsErrorNotReady if not.

This is thread-safe and returns a snapshot of the peak share memory usage of the stream.

**See also:**

topsStreamCreate, topsStreamCreateWithFlags, topsStreamDestroy, topsStreamDestroy

**Parameters:**

- **stream** -- **[in]** Stream to be queried
- **sharedMemPeak** -- **[inout]** Returns the the peak share memory usages of the stream

**Returns:** topsSuccess, topsErrorNotReady, #topsErrorInvalidHandle

### 2.13. Profiler

This section describes the profiler control functions of TOPS runtime API

```cpp
TOPS_PUBLIC_API topsError_t topsProfilerStart(void)
```

Enable profiling.

Enables profile collection by the active profiling tool for the current context. If profiling is already enabled, then `topsProfilerStart` has no effect.

topsProfilerStart and topsProfilerStop APIs are used to programmatically control the profiling granularity by allowing profiling to be done only on selective pieces of code.

**See also:**

topsProfilerStop

**Returns:** topsSuccess, topsErrorInvalidContext

```cpp
TOPS_PUBLIC_API topsError_t topsProfilerStop(void)
```

Disable profiling.

Disables profile collection by the active profiling tool for the current context. If profiling is already disabled, then `topsProfilerStop` has no effect.

topsProfilerStart and topsProfilerStop APIs are used to programmatically control the profiling granularity by allowing profiling to be done only on selective pieces of code.

**See also:**

topsProfilerStart

**Returns:** topsSuccess, topsErrorInvalidContext
