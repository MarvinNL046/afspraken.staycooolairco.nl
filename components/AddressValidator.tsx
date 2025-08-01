import React, { useState, useCallback, useEffect, useRef } from 'react';

interface AddressValidatorProps {
  onValidAddress: (isValid: boolean, serviceArea?: any) => void;
  className?: string;
}

interface ValidationResult {
  isInServiceArea: boolean;
  confidence: number;
  message: string;
  serviceArea?: {
    name: string;
    calendarColorId: string;
    salesPersonName: string;
  };
}

export function AddressValidator({ onValidAddress, className = '' }: AddressValidatorProps) {
  const [address, setAddress] = useState({
    street: '',
    houseNumber: '',
    postalCode: '',
    city: ''
  });
  
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [quickCheckResult, setQuickCheckResult] = useState<boolean | null>(null);
  const quickCheckTimeout = useRef<NodeJS.Timeout | null>(null);

  // Quick postal code check (debounced)
  const quickCheck = useCallback(async (postalCode: string) => {
      if (!postalCode || postalCode.length < 4) {
        setQuickCheckResult(null);
        return;
      }

      try {
        const response = await fetch(
          `/.netlify/functions/check-service-boundary?postalCode=${encodeURIComponent(postalCode)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setQuickCheckResult(data.isLikelyInServiceArea);
        }
      } catch (error) {
        console.error('Quick check error:', error);
      }
    },
    []
  );

  // Full address validation
  const validateFullAddress = async () => {
    if (!address.street || !address.houseNumber || !address.postalCode || !address.city) {
      return;
    }

    setIsValidating(true);
    
    try {
      const response = await fetch('/.netlify/functions/check-service-boundary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(address),
      });

      const data = await response.json();
      
      if (response.ok) {
        setValidation({
          isInServiceArea: data.validation.isInServiceArea,
          confidence: data.validation.confidence,
          message: data.validation.message,
          serviceArea: data.serviceArea
        });
        
        onValidAddress(data.validation.isInServiceArea, data.serviceArea);
      } else {
        setValidation({
          isInServiceArea: false,
          confidence: 0,
          message: data.message || 'Validatie mislukt'
        });
        
        onValidAddress(false);
      }
    } catch (error) {
      console.error('Validation error:', error);
      setValidation({
        isInServiceArea: false,
        confidence: 0,
        message: 'Er is een fout opgetreden bij de validatie'
      });
      
      onValidAddress(false);
    } finally {
      setIsValidating(false);
    }
  };

  // Trigger quick check when postal code changes (with debounce)
  useEffect(() => {
    // Clear previous timeout
    if (quickCheckTimeout.current) {
      clearTimeout(quickCheckTimeout.current);
    }

    // Set new timeout
    quickCheckTimeout.current = setTimeout(() => {
      quickCheck(address.postalCode);
    }, 500);

    // Cleanup
    return () => {
      if (quickCheckTimeout.current) {
        clearTimeout(quickCheckTimeout.current);
      }
    };
  }, [address.postalCode, quickCheck]);

  // Format postal code
  const formatPostalCode = (value: string) => {
    // Remove all non-alphanumeric characters
    const cleaned = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    
    // Format as "1234 AB"
    if (cleaned.length >= 4) {
      return cleaned.slice(0, 4) + (cleaned.length > 4 ? ' ' + cleaned.slice(4, 6) : '');
    }
    
    return cleaned;
  };

  return (
    <div className={`address-validator ${className}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label htmlFor="street" className="block text-sm font-medium text-gray-700">
            Straatnaam
          </label>
          <input
            type="text"
            id="street"
            value={address.street}
            onChange={(e) => setAddress({ ...address, street: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="Vrijthof"
          />
        </div>

        <div>
          <label htmlFor="houseNumber" className="block text-sm font-medium text-gray-700">
            Huisnummer
          </label>
          <input
            type="text"
            id="houseNumber"
            value={address.houseNumber}
            onChange={(e) => setAddress({ ...address, houseNumber: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="1"
          />
        </div>

        <div>
          <label htmlFor="postalCode" className="block text-sm font-medium text-gray-700">
            Postcode
          </label>
          <div className="relative">
            <input
              type="text"
              id="postalCode"
              value={address.postalCode}
              onChange={(e) => setAddress({ ...address, postalCode: formatPostalCode(e.target.value) })}
              className={`mt-1 block w-full rounded-md shadow-sm focus:ring-blue-500 ${
                quickCheckResult === false
                  ? 'border-red-300 focus:border-red-500'
                  : quickCheckResult === true
                  ? 'border-green-300 focus:border-green-500'
                  : 'border-gray-300 focus:border-blue-500'
              }`}
              placeholder="6211 LD"
              maxLength={7}
            />
            {quickCheckResult !== null && (
              <div className="absolute inset-y-0 right-0 flex items-center pr-3">
                {quickCheckResult ? (
                  <svg className="h-5 w-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
            )}
          </div>
          {quickCheckResult === false && (
            <p className="mt-1 text-sm text-red-600">
              Deze postcode ligt mogelijk buiten ons servicegebied
            </p>
          )}
        </div>

        <div>
          <label htmlFor="city" className="block text-sm font-medium text-gray-700">
            Plaats
          </label>
          <input
            type="text"
            id="city"
            value={address.city}
            onChange={(e) => setAddress({ ...address, city: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            placeholder="Maastricht"
          />
        </div>
      </div>

      <div className="mt-4">
        <button
          type="button"
          onClick={validateFullAddress}
          disabled={
            isValidating ||
            !address.street ||
            !address.houseNumber ||
            !address.postalCode ||
            !address.city
          }
          className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
            isValidating
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500'
          }`}
        >
          {isValidating ? (
            <>
              <svg
                className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Valideren...
            </>
          ) : (
            'Valideer Adres'
          )}
        </button>
      </div>

      {validation && (
        <div
          className={`mt-4 p-4 rounded-md ${
            validation.isInServiceArea
              ? 'bg-green-50 border border-green-200'
              : 'bg-red-50 border border-red-200'
          }`}
        >
          <div className="flex">
            <div className="flex-shrink-0">
              {validation.isInServiceArea ? (
                <svg
                  className="h-5 w-5 text-green-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  className="h-5 w-5 text-red-400"
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
            <div className="ml-3">
              <h3
                className={`text-sm font-medium ${
                  validation.isInServiceArea ? 'text-green-800' : 'text-red-800'
                }`}
              >
                {validation.message}
              </h3>
              {validation.serviceArea && (
                <div className="mt-2 text-sm text-green-700">
                  <p>Servicegebied: {validation.serviceArea.name}</p>
                  <p>Verkoper: {validation.serviceArea.salesPersonName}</p>
                </div>
              )}
              <p className="mt-1 text-xs text-gray-600">
                Zekerheid: {validation.confidence}%
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}