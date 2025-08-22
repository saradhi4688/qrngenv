import numpy as np
import random
from typing import List

class QuantumRandomGenerator:
    """
    Simulates a Quantum Random Number Generator using superposition principles.
    
    This class mimics the behavior of a real quantum computer where:
    1. Qubits are prepared in superposition states
    2. Hadamard gates create equal probability superpositions
    3. Measurements collapse the superposition randomly
    """
    
    def __init__(self):
        self.circuit_history = []
    
    def generate_numbers(self, num_bits: int, num_samples: int) -> np.ndarray:
        """
        Generate quantum random numbers by simulating quantum circuits.
        
        Args:
            num_bits: Number of qubits/bits per random number (1-16)
            num_samples: How many random numbers to generate (1-1000)
            
        Returns:
            Array of quantum random numbers
        """
        if not (1 <= num_bits <= 16):
            raise ValueError("num_bits must be between 1 and 16")
        
        if not (1 <= num_samples <= 1000):
            raise ValueError("num_samples must be between 1 and 1000")
        
        results = []
        
        for sample in range(num_samples):
            # Simulate quantum circuit for this sample
            quantum_number = self._simulate_quantum_circuit(num_bits)
            results.append(quantum_number)
            
            # Store circuit execution details
            self.circuit_history.append({
                'sample': sample + 1,
                'num_bits': num_bits,
                'result': quantum_number,
                'binary': format(quantum_number, f'0{num_bits}b')
            })
        
        return np.array(results)
    
    def _simulate_quantum_circuit(self, num_bits: int) -> int:
        """
        Simulate a quantum circuit that:
        1. Initializes qubits in |0⟩ state
        2. Applies Hadamard gates for superposition
        3. Measures all qubits
        
        Args:
            num_bits: Number of qubits in the circuit
            
        Returns:
            Integer result from quantum measurements
        """
        quantum_result = 0
        
        for bit_position in range(num_bits):
            # Simulate qubit in superposition state |+⟩ = (|0⟩ + |1⟩)/√2
            # Measurement has exactly 50% probability for each outcome
            measurement_result = self._quantum_measurement()
            
            # Set the bit if measurement result is 1
            if measurement_result == 1:
                quantum_result |= (1 << bit_position)
        
        return quantum_result
    
    def _quantum_measurement(self) -> int:
        """
        Simulate quantum measurement of a qubit in superposition.
        
        In a real quantum computer, this would be true quantum randomness.
        Here we simulate it with classical randomness that has the same
        statistical properties.
        
        Returns:
            0 or 1 with exactly 50% probability each
        """
        # This simulates the fundamental quantum randomness
        # In reality, this comes from quantum mechanical processes
        return random.choice([0, 1])
    
    def get_circuit_info(self, num_bits: int) -> dict:
        """
        Get information about the quantum circuit structure.
        
        Args:
            num_bits: Number of qubits
            
        Returns:
            Dictionary with circuit information
        """
        return {
            "circuit_type": "Quantum Random Number Generator",
            "num_qubits": num_bits,
            "gates": [
                {
                    "type": "Hadamard",
                    "qubits": list(range(num_bits)),
                    "purpose": "Create superposition |+⟩ = (|0⟩ + |1⟩)/√2"
                }
            ],
            "measurements": {
                "qubits": list(range(num_bits)),
                "probability": "50% for |0⟩, 50% for |1⟩ per qubit"
            },
            "output_range": f"0 to {2**num_bits - 1}",
            "quantum_principle": "Fundamental randomness from quantum mechanics"
        }
    
    def get_history(self) -> List[dict]:
        """Get the history of generated numbers."""
        return self.circuit_history
    
    def clear_history(self):
        """Clear the generation history."""
        self.circuit_history = []

# Example usage and testing
if __name__ == "__main__":
    qrng = QuantumRandomGenerator()
    
    # Generate some quantum random numbers
    print("Quantum Random Number Generator Test")
    print("=" * 40)
    
    numbers = qrng.generate_numbers(num_bits=4, num_samples=10)
    print(f"Generated numbers: {numbers}")
    print(f"Binary representations:")
    
    for i, num in enumerate(numbers):
        binary = format(num, '04b')
        print(f"  Sample {i+1}: {num:2d} = {binary}")
    
    # Show statistics
    print(f"\nStatistics:")
    print(f"  Mean: {np.mean(numbers):.2f}")
    print(f"  Std:  {np.std(numbers):.2f}")
    print(f"  Min:  {np.min(numbers)}")
    print(f"  Max:  {np.max(numbers)}")
    
    # Show circuit info
    circuit_info = qrng.get_circuit_info(4)
    print(f"\nCircuit Information:")
    print(f"  Type: {circuit_info['circuit_type']}")
    print(f"  Qubits: {circuit_info['num_qubits']}")
    print(f"  Range: {circuit_info['output_range']}")
