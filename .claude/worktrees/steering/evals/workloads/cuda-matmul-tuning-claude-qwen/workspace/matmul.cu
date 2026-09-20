#include <cuda_runtime.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <random>
#include <string>
#include <vector>

namespace {

constexpr int kM = 512;
constexpr int kN = 512;
constexpr int kK = 512;
constexpr int kTile = 16;
constexpr float kTolerance = 1.0e-3f;      // relative tolerance for non-zero entries
constexpr float kAbsoluteTolerance = 1.0e-3f;  // absolute floor so near-zero outputs cannot fail

__global__ void matmul_kernel(const float* a, const float* b, float* c) {
  __shared__ float tile_a[kTile][kTile];
  __shared__ float tile_b[kTile][kTile];

  const int row = blockIdx.y * kTile + threadIdx.y;
  const int col = blockIdx.x * kTile + threadIdx.x;
  float acc = 0.0f;

  for (int base = 0; base < kK; base += kTile) {
    tile_a[threadIdx.y][threadIdx.x] = a[row * kK + base + threadIdx.x];
    tile_b[threadIdx.y][threadIdx.x] = b[(base + threadIdx.y) * kN + col];
    __syncthreads();
    for (int k = 0; k < kTile; ++k) {
      acc += tile_a[threadIdx.y][k] * tile_b[k][threadIdx.x];
    }
    __syncthreads();
  }

  c[row * kN + col] = acc;
}

void check_cuda(cudaError_t status, const char* operation) {
  if (status != cudaSuccess) {
    std::cerr << operation << ": " << cudaGetErrorString(status) << "\n";
    std::exit(1);
  }
}

std::vector<float> make_input(int seed) {
  std::mt19937 generator(seed);
  std::uniform_real_distribution<float> distribution(-1.0f, 1.0f);
  std::vector<float> values(static_cast<size_t>(kM) * kK);
  for (float& value : values) value = distribution(generator);
  return values;
}

void launch(const float* a, const float* b, float* c, cudaStream_t stream = nullptr) {
  const dim3 block(kTile, kTile);
  const dim3 grid(kN / kTile, kM / kTile);
  matmul_kernel<<<grid, block, 0, stream>>>(a, b, c);
  check_cuda(cudaGetLastError(), "matmul kernel launch");
}

float max_relative_error(const std::vector<float>& actual,
                         const std::vector<float>& expected) {
  float maximum = 0.0f;
  for (size_t index = 0; index < actual.size(); ++index) {
    // Combined absolute+relative tolerance (torch.allclose semantics), matching
    // the Triton matmul-512 case. A pure relative error with a 1e-6 denominator
    // floor is ill-posed for near-zero outputs and rejects a numerically-correct
    // kernel (ISSUE-017).
    const float denominator = kAbsoluteTolerance + kTolerance * std::fabs(expected[index]);
    maximum = std::max(maximum, std::fabs(actual[index] - expected[index]) / denominator);
  }
  return maximum;
}

void cpu_reference(const std::vector<float>& a,
                   const std::vector<float>& b,
                   std::vector<float>& c) {
  for (int row = 0; row < kM; ++row) {
    for (int col = 0; col < kN; ++col) {
      float value = 0.0f;
      for (int k = 0; k < kK; ++k) value += a[row * kK + k] * b[k * kN + col];
      c[row * kN + col] = value;
    }
  }
}

struct DeviceBuffers {
  float* a = nullptr;
  float* b = nullptr;
  float* c = nullptr;

  ~DeviceBuffers() {
    if (a != nullptr) cudaFree(a);
    if (b != nullptr) cudaFree(b);
    if (c != nullptr) cudaFree(c);
  }
};

DeviceBuffers upload(const std::vector<float>& a, const std::vector<float>& b) {
  DeviceBuffers buffers;
  const size_t matrix_bytes = static_cast<size_t>(kM) * kK * sizeof(float);
  const size_t output_bytes = static_cast<size_t>(kM) * kN * sizeof(float);
  check_cuda(cudaMalloc(&buffers.a, matrix_bytes), "cudaMalloc(A)");
  check_cuda(cudaMalloc(&buffers.b, matrix_bytes), "cudaMalloc(B)");
  check_cuda(cudaMalloc(&buffers.c, output_bytes), "cudaMalloc(C)");
  check_cuda(cudaMemcpy(buffers.a, a.data(), matrix_bytes, cudaMemcpyHostToDevice), "copy A");
  check_cuda(cudaMemcpy(buffers.b, b.data(), matrix_bytes, cudaMemcpyHostToDevice), "copy B");
  return buffers;
}

int verify() {
  const auto a = make_input(7);
  const auto b = make_input(11);
  std::vector<float> expected(static_cast<size_t>(kM) * kN);
  std::vector<float> actual(static_cast<size_t>(kM) * kN);
  cpu_reference(a, b, expected);
  auto buffers = upload(a, b);
  launch(buffers.a, buffers.b, buffers.c);
  check_cuda(cudaDeviceSynchronize(), "synchronize verification");
  check_cuda(cudaMemcpy(actual.data(), buffers.c, actual.size() * sizeof(float), cudaMemcpyDeviceToHost), "copy C");
  const float error = max_relative_error(actual, expected);
  std::cout << std::setprecision(8) << "max_rel_error=" << error << "\n";
  if (error > 1.0f) {
    std::cout << "VERIFY: FAIL\n";
    return 1;
  }
  std::cout << "VERIFY: PASS\n";
  return 0;
}

int benchmark() {
  const auto a = make_input(7);
  const auto b = make_input(11);
  auto buffers = upload(a, b);
  for (int warmup = 0; warmup < 5; ++warmup) launch(buffers.a, buffers.b, buffers.c);
  check_cuda(cudaDeviceSynchronize(), "synchronize warmup");

  cudaEvent_t start = nullptr;
  cudaEvent_t stop = nullptr;
  check_cuda(cudaEventCreate(&start), "create start event");
  check_cuda(cudaEventCreate(&stop), "create stop event");
  constexpr int kSamples = 20;
  check_cuda(cudaEventRecord(start), "record start event");
  for (int sample = 0; sample < kSamples; ++sample) launch(buffers.a, buffers.b, buffers.c);
  check_cuda(cudaEventRecord(stop), "record stop event");
  check_cuda(cudaEventSynchronize(stop), "synchronize benchmark");
  float elapsed_ms = 0.0f;
  check_cuda(cudaEventElapsedTime(&elapsed_ms, start, stop), "measure benchmark");
  cudaEventDestroy(start);
  cudaEventDestroy(stop);

  const double average_ms = static_cast<double>(elapsed_ms) / kSamples;
  const double tflops = (2.0 * kM * kN * kK) / (average_ms * 1.0e9);
  std::cout << std::fixed << std::setprecision(6)
            << "KERNEL_MS: " << average_ms << "\n"
            << "TFLOPS: " << tflops << "\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: matmul --verify|--bench\n";
    return 2;
  }
  const std::string mode(argv[1]);
  if (mode == "--verify") return verify();
  if (mode == "--bench") return benchmark();
  std::cerr << "unknown mode: " << mode << "\n";
  return 2;
}
